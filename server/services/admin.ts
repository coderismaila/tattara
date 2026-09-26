// Bootstrapping the top of the hierarchy (PRD §5: "The DG is created by an admin"). ADMIN and DG have no unit, so
// the one-active-lead-per-unit index can't enforce "one DG": this service does. Pure (DB injected).
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { userDevices, users } from '../db/schema/index.ts'
import type { DgSummary } from '../../shared/types/admin.ts'
import { SMS_TEXT } from '../../shared/constants/sms-text.ts'
import { maskPhoneForDisplay } from '../../shared/utils/phone.ts'
import { recordAudit } from './audit.ts'
import { type AuthConfig, type OnSmsQueued, createInvite, inviteUrl } from './auth.ts'
import { enqueueSms } from './sms.ts'
import { deactivateUser } from './team.ts'

export type RegionRole = 'ADMIN' | 'DG'

export interface CreateRegionUserInput {
  role: RegionRole
  fullName: string
  /** E.164 (normalised by the caller's schema). */
  phone: string
  /** DG only: deactivate the current active DG as part of this step. */
  replace?: boolean
  /** The ADMIN who did it; null for the CLI. */
  createdBy: { id: string, role: 'ADMIN' } | null
}

export type CreateRegionUserResult
  = | { kind: 'ok', userId: string, token: string, replacedUserId: string | null }
    | { kind: 'dg_exists' }
    | { kind: 'phone_in_use' }

export async function createRegionUser(db: Db, input: CreateRegionUserInput): Promise<CreateRegionUserResult> {
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id, status: users.status, role: users.role }).from(users).where(eq(users.phone, input.phone))
    // Active/locked users keep their number; so does someone with a pending invite for a different role (e.g. a ward lead).
    if (existing && existing.status !== 'deactivated' && !(existing.status === 'invited' && existing.role === input.role)) {
      return { kind: 'phone_in_use' } as const
    }

    let replacedUserId: string | null = null
    if (input.role === 'DG') {
      const [dg] = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, 'DG'), eq(users.status, 'active')))
      if (dg && !input.replace) return { kind: 'dg_exists' } as const
      if (dg) {
        await deactivateUser(tx, dg.id)
        replacedUserId = dg.id
      }
      // One pending DG invite at a time.
      await tx.update(users).set({ status: 'deactivated', sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: sql`now()` })
        .where(and(eq(users.role, 'DG'), eq(users.status, 'invited'), existing ? sql`${users.id} <> ${existing.id}` : sql`true`))
    }

    const values = {
      fullName: input.fullName,
      role: input.role,
      unitCode: null,
      unitLevel: null,
      status: 'invited' as const,
      pinHash: null,
      failedPinAttempts: 0,
      lockedUntil: null,
      invitedBy: input.createdBy?.id ?? null,
    }
    let userId: string
    if (existing) {
      await tx.update(users).set({ ...values, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: sql`now()` }).where(eq(users.id, existing.id))
      await tx.update(userDevices).set({ revokedAt: sql`now()` }).where(and(eq(userDevices.userId, existing.id), sql`${userDevices.revokedAt} is null`))
      userId = existing.id
    }
    else {
      const [row] = await tx.insert(users).values({ ...values, phone: input.phone }).returning({ id: users.id })
      userId = row!.id
    }
    return { kind: 'ok', userId, replacedUserId } as const
  })
  if (result.kind !== 'ok') return result

  const token = await createInvite(db, result.userId, input.createdBy?.id ?? null)
  const actor = { id: input.createdBy?.id ?? null, role: input.createdBy?.role ?? null, ip: null }
  const via = input.createdBy ? 'admin' : 'cli'
  if (result.replacedUserId) {
    await recordAudit(db, actor, { action: 'user.deactivate', targetType: 'user', targetId: result.replacedUserId, meta: { reason: 'replaced', via } })
  }
  await recordAudit(db, actor, { action: 'user.create', targetType: 'user', targetId: result.userId, meta: { role: input.role, via } })
  return { kind: 'ok', userId: result.userId, token, replacedUserId: result.replacedUserId }
}

/** The admin page's invite: create (or re-invite) the DG and text them the setup link. */
export async function inviteDg(
  db: Db,
  admin: { id: string, role: 'ADMIN' },
  input: { fullName: string, phone: string, replace?: boolean },
  cfg: AuthConfig,
  onSmsQueued: OnSmsQueued = () => {},
): Promise<Exclude<CreateRegionUserResult, { kind: 'ok' }> | { kind: 'ok', userId: string, replacedUserId: string | null }> {
  const result = await createRegionUser(db, { role: 'DG', ...input, createdBy: admin })
  if (result.kind !== 'ok') return result
  await enqueueSms(db, { to: input.phone, body: SMS_TEXT.invite(inviteUrl(cfg, result.token)), purpose: 'invite', createdBy: admin.id })
  onSmsQueued()
  return { kind: 'ok', userId: result.userId, replacedUserId: result.replacedUserId }
}

/** The active DG, else the pending DG invite, else null. For the admin page. */
export async function currentDg(db: Db): Promise<DgSummary | null> {
  const rows = await db.select({
    id: users.id,
    fullName: users.fullName,
    status: users.status,
    phone: users.phone,
    locked: sql<boolean>`coalesce(${users.lockedUntil} > now(), false)`,
    lastSeenAt: users.lastSeenAt,
  }).from(users).where(and(eq(users.role, 'DG'), sql`${users.status} in ('active', 'invited')`))
  const dg = rows.find(r => r.status === 'active') ?? rows[0]
  if (!dg) return null
  return {
    id: dg.id,
    fullName: dg.fullName,
    status: dg.status === 'active' ? (dg.locked ? 'locked' : 'active') : 'invited',
    phone: maskPhoneForDisplay(dg.phone),
    lastSeenAt: dg.lastSeenAt?.toISOString() ?? null,
  }
}
