// Team management (PRD US-1, US-3, R-1; SECURITY_PRIVACY §3): a lead manages the leads of the units DIRECTLY below
// their own — ward → PU leads, LGA → ward leads, state → LGA leads, DG → state leads. ADMIN → DG is task 2.6.
// Pure (DB injected); routes map the result kinds to HTTP statuses.
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import { units, userDevices, users } from '../db/schema/index.ts'
import { CHILD_ROLE, ROLE_LEVEL, roleForLevel, type Role } from '../../shared/constants/roles.ts'
import type { UnitLevel } from '../../shared/constants/enums.ts'
import type { SessionUser } from '../../shared/types/auth.ts'
import type { TeamMember } from '../../shared/types/team.ts'
import { maskPhoneForDisplay } from '../../shared/utils/phone.ts'
import { isWithin, parentCode } from '../../shared/utils/pu-code.ts'
import { assertAuditMetaSafe, recordAudit } from './audit.ts'
import { sendInvite, type AuthConfig, type OnSmsQueued } from './auth.ts'

type Caller = Pick<SessionUser, 'id' | 'role' | 'unitCode'>

/** Leads who manage a team: every lead role with a child role, except ADMIN (whose only child, the DG, is 2.6). */
export function canManageTeam(role: Role): boolean {
  return role !== 'ADMIN' && CHILD_ROLE[role] !== null
}

/** Is `unitCode` a unit directly below the caller's unit? (DG: the states.) */
const isDirectChildOf = (caller: Caller, unitCode: string) => parentCode(unitCode) === (caller.unitCode ?? '')

export type ListTeamResult
  = | { kind: 'ok', unit: { code: string, name: string, level: UnitLevel | 'region' }, canManage: boolean, members: TeamMember[] }
    | { kind: 'forbidden' }

/** Child units of `unitCode` (default: the caller's own unit) with their lead. `unitCode` must be in the caller's scope. */
export async function listTeam(db: Db, caller: Caller, unitCode?: string): Promise<ListTeamResult> {
  if (!canManageTeam(caller.role)) return { kind: 'forbidden' }
  const own = caller.unitCode ?? ''
  const target = unitCode ?? own
  if (target !== '' && !isWithin(target, own)) return { kind: 'forbidden' }
  if (target === '' && own !== '') return { kind: 'forbidden' }

  let unit: { code: string, name: string, level: UnitLevel | 'region' } = { code: '', name: '', level: 'region' }
  if (target !== '') {
    const [row] = await db.select({ code: units.code, name: units.name, level: units.level }).from(units).where(eq(units.code, target))
    if (!row || row.level === 'pu') return { kind: 'forbidden' }
    unit = row
  }

  const children = await db.select({ code: units.code, name: units.name, level: units.level }).from(units)
    .where(and(eq(units.active, true), target === '' ? eq(units.level, 'state') : eq(units.parentCode, target)))
    .orderBy(units.code)

  const leads = children.length === 0
    ? []
    : await db.select({
        id: users.id,
        unitCode: users.unitCode,
        fullName: users.fullName,
        phone: users.phone,
        status: users.status,
        locked: sql<boolean>`coalesce(${users.lockedUntil} > now(), false)`,
        lastSeenAt: users.lastSeenAt,
        createdAt: users.createdAt,
      }).from(users)
        .where(and(inArray(users.unitCode, children.map(c => c.code)), ne(users.status, 'deactivated')))
        .orderBy(desc(users.createdAt))

  const direct = target === own
  const members: TeamMember[] = children.map((c) => {
    const candidates = leads.filter(l => l.unitCode === c.code)
    // The active lead if there is one, else the newest pending invite.
    const lead = candidates.find(l => l.status === 'active') ?? candidates[0]
    return {
      code: c.code,
      name: c.name,
      level: c.level,
      qualityScore: null,
      lead: lead
        ? {
            id: lead.id,
            fullName: lead.fullName,
            status: lead.status === 'active' ? (lead.locked ? 'locked' : 'active') : 'invited',
            phone: direct ? lead.phone : maskPhoneForDisplay(lead.phone),
            lastSeenAt: lead.lastSeenAt?.toISOString() ?? null,
          }
        : null,
    }
  })

  return { kind: 'ok', unit, canManage: direct, members }
}

// ── Invite ──────────────────────────────────────────────────────────────────

export type InviteResult
  = | { kind: 'ok', userId: string, replacedUserId: string | null }
    | { kind: 'forbidden' }
    | { kind: 'unit_has_active_lead' }
    | { kind: 'already_active' }
    | { kind: 'phone_in_use' }

export interface InviteInput {
  unitCode: string
  fullName: string
  /** E.164 (normalised by the shared schema). */
  phone: string
  /** Deactivate the unit's current active lead as part of this invite (PRD R-1). */
  replace?: boolean
}

export async function inviteLead(
  db: Db,
  caller: Caller,
  input: InviteInput,
  cfg: AuthConfig,
  onSmsQueued: OnSmsQueued = () => {},
): Promise<InviteResult> {
  if (!canManageTeam(caller.role) || !isDirectChildOf(caller, input.unitCode)) return { kind: 'forbidden' }
  const [unit] = await db.select({ level: units.level, active: units.active }).from(units).where(eq(units.code, input.unitCode))
  if (!unit || !unit.active) return { kind: 'forbidden' }
  const role = roleForLevel(unit.level)
  if (role !== CHILD_ROLE[caller.role]) return { kind: 'forbidden' }

  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: users.id, phone: users.phone }).from(users)
      .where(and(eq(users.unitCode, input.unitCode), eq(users.role, role), eq(users.status, 'active')))
    if (current?.phone === input.phone) return { kind: 'already_active' } as const
    if (current && !input.replace) return { kind: 'unit_has_active_lead' } as const

    const [existing] = await tx.select({ id: users.id, status: users.status }).from(users).where(eq(users.phone, input.phone))
    if (existing && existing.status !== 'invited' && existing.status !== 'deactivated') return { kind: 'phone_in_use' } as const

    let replacedUserId: string | null = null
    if (current) {
      await deactivateUser(tx, current.id)
      replacedUserId = current.id
    }

    // Supersede other pending invites for this unit, so there is one outstanding invite per unit.
    const superseded = await tx.update(users).set({ status: 'deactivated', sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: sql`now()` })
      .where(and(eq(users.unitCode, input.unitCode), eq(users.status, 'invited'), existing ? ne(users.id, existing.id) : sql`true`))
      .returning({ id: users.id })

    const values = {
      fullName: input.fullName,
      role,
      unitCode: input.unitCode,
      unitLevel: ROLE_LEVEL[role],
      status: 'invited' as const,
      pinHash: null,
      failedPinAttempts: 0,
      lockedUntil: null,
      invitedBy: caller.id,
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
    return { kind: 'ok', userId, replacedUserId, superseded: superseded.map(s => s.id) } as const
  })
  if (result.kind !== 'ok') return result

  await sendInvite(db, result.userId, caller.id, cfg, onSmsQueued)
  const actor = { id: caller.id, role: caller.role, ip: null }
  if (result.replacedUserId) {
    await recordAudit(db, actor, { action: 'user.deactivate', targetType: 'user', targetId: result.replacedUserId, scopeCode: input.unitCode, meta: { reason: 'replaced' } })
  }
  for (const id of result.superseded) {
    await recordAudit(db, actor, { action: 'user.deactivate', targetType: 'user', targetId: id, scopeCode: input.unitCode, meta: { reason: 'invite superseded' } })
  }
  await recordAudit(db, actor, {
    action: 'user.invite',
    targetType: 'user',
    targetId: result.userId,
    scopeCode: input.unitCode,
    meta: { role, replaced: result.replacedUserId !== null },
  })
  return { kind: 'ok', userId: result.userId, replacedUserId: result.replacedUserId }
}

// ── Deactivate / reset PIN ──────────────────────────────────────────────────

/** Status deactivated, sessions revoked (session_version bump), devices revoked (wiped on next contact, 4.5). */
async function deactivateUser(db: DbLike, userId: string) {
  await db.update(users).set({
    status: 'deactivated',
    sessionVersion: sql`${users.sessionVersion} + 1`,
    lockedUntil: null,
    updatedAt: sql`now()`,
  }).where(eq(users.id, userId))
  await db.update(userDevices).set({ revokedAt: sql`now()` }).where(and(eq(userDevices.userId, userId), sql`${userDevices.revokedAt} is null`))
}

type TargetCheck = { kind: 'ok', target: { id: string, unitCode: string } } | { kind: 'forbidden' } | { kind: 'not_found' } | { kind: 'already_deactivated' }

async function checkTarget(db: Db, caller: Caller, userId: string): Promise<TargetCheck> {
  if (!canManageTeam(caller.role) || userId === caller.id) return { kind: 'forbidden' }
  const [target] = await db.select({ id: users.id, unitCode: users.unitCode, role: users.role, status: users.status }).from(users).where(eq(users.id, userId))
  if (!target) return { kind: 'not_found' }
  // Out of reach and unknown look the same from outside (403), so ids can't be probed across units.
  if (!target.unitCode || !isDirectChildOf(caller, target.unitCode) || target.role !== CHILD_ROLE[caller.role]) return { kind: 'forbidden' }
  if (target.status === 'deactivated') return { kind: 'already_deactivated' }
  return { kind: 'ok', target: { id: target.id, unitCode: target.unitCode } }
}

export type DeactivateResult = Exclude<TargetCheck, { kind: 'ok' }> | { kind: 'ok' }

export async function deactivateLead(db: Db, caller: Caller, userId: string, reason: string): Promise<DeactivateResult> {
  // Reject PII in the reason before touching anything (it is stored in the audit log).
  assertAuditMetaSafe({ reason })
  const check = await checkTarget(db, caller, userId)
  if (check.kind !== 'ok') return check

  await db.transaction(async tx => deactivateUser(tx, userId))
  await recordAudit(db, { id: caller.id, role: caller.role, ip: null }, {
    action: 'user.deactivate',
    targetType: 'user',
    targetId: userId,
    scopeCode: check.target.unitCode,
    meta: { reason },
  })
  return { kind: 'ok' }
}

export type ResetPinResult = Exclude<TargetCheck, { kind: 'ok' }> | { kind: 'ok' }

/** New invite link; the old PIN, sessions and trusted devices stop working (lost phone, forgotten PIN). */
export async function resetLeadPin(
  db: Db,
  caller: Caller,
  userId: string,
  cfg: AuthConfig,
  onSmsQueued: OnSmsQueued = () => {},
): Promise<ResetPinResult> {
  const check = await checkTarget(db, caller, userId)
  if (check.kind !== 'ok') return check

  await db.transaction(async (tx) => {
    await tx.update(users).set({
      status: 'invited',
      pinHash: null,
      failedPinAttempts: 0,
      lockedUntil: null,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: sql`now()`,
    }).where(eq(users.id, userId))
    await tx.update(userDevices).set({ revokedAt: sql`now()` }).where(and(eq(userDevices.userId, userId), sql`${userDevices.revokedAt} is null`))
  })
  await sendInvite(db, userId, caller.id, cfg, onSmsQueued)
  await recordAudit(db, { id: caller.id, role: caller.role, ip: null }, {
    action: 'user.reset_pin',
    targetType: 'user',
    targetId: userId,
    scopeCode: check.target.unitCode,
  })
  return { kind: 'ok' }
}
