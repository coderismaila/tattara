// Supporter records (PRD §6.2, ARCHITECTURE §5 and §7, SECURITY_PRIVACY §3–4). Pure (DB injected).
// The only module that reads or writes `supporters` directly (a test enforces it). Writes keep pu_stats in step in
// the same transaction. Duplicate-phone limits (3.5) and flags (5.1) build on top of this.
import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import { puStats, supporters, units, type Supporter } from '../db/schema/index.ts'
import type { Role } from '../../shared/constants/roles.ts'
import type { SessionUser } from '../../shared/types/auth.ts'
import {
  SUPPORTER_EDITABLE_FIELDS,
  type MaskedSupporterDto,
  type SupporterDto,
  type SupporterEditableField,
  type SupporterInput,
  type SupporterPatch,
} from '../../shared/types/supporter.ts'
import { maskPhoneForDisplay } from '../../shared/utils/phone.ts'
import { isValidPuCode, isWithin, unitLevel } from '../../shared/utils/pu-code.ts'
import { isUuidV7 } from '../../shared/utils/uuid.ts'
import { recordAudit } from './audit.ts'

type Caller = Pick<SessionUser, 'id' | 'role' | 'unitCode'>

const E164_NG_MOBILE = /^\+234[789][01]\d{8}$/

// ── pu_stats ────────────────────────────────────────────────────────────────

/** pu_stats counters derived from supporter rows (flagged_open comes from flags, 5.1). Key → column name. */
const STAT_COLUMNS = {
  total: 'total',
  verified: 'verified',
  male: 'male',
  female: 'female',
  age18_24: 'age_18_24',
  age25_34: 'age_25_34',
  age35_44: 'age_35_44',
  age45_54: 'age_45_54',
  age55_64: 'age_55_64',
  age65Plus: 'age_65_plus',
  strong: 'strong',
  leaning: 'leaning',
  undecided: 'undecided',
  hasPvcYes: 'has_pvc_yes',
  volunteers: 'volunteers',
  optedOut: 'opted_out',
} as const
export type StatKey = keyof typeof STAT_COLUMNS
export type StatVector = Record<StatKey, number>
const STAT_KEYS = Object.keys(STAT_COLUMNS) as StatKey[]

const AGE_KEY = {
  '18_24': 'age18_24',
  '25_34': 'age25_34',
  '35_44': 'age35_44',
  '45_54': 'age45_54',
  '55_64': 'age55_64',
  '65_plus': 'age65Plus',
} as const satisfies Record<NonNullable<Supporter['ageBand']>, StatKey>

type StatSource = Pick<Supporter, 'gender' | 'ageBand' | 'supportLevel' | 'hasPvc' | 'volunteer' | 'verification'>

/**
 * What one supporter row adds to its PU's counters. Every row counts, including removal-requested and anonymised
 * ones (anonymisation keeps the enums for aggregate integrity, DATA_MODEL §3); opt-outs are also counted apart.
 * "Verified" = the thank-you SMS was delivered or a call-back confirmed the supporter (ADR-027).
 */
export function statContribution(row: StatSource): StatVector {
  const v = Object.fromEntries(STAT_KEYS.map(k => [k, 0])) as StatVector
  v.total = 1
  if (row.verification === 'sms_delivered' || row.verification === 'callback_verified') v.verified = 1
  if (row.verification === 'opted_out') v.optedOut = 1
  if (row.gender) v[row.gender] = 1
  if (row.ageBand) v[AGE_KEY[row.ageBand]] = 1
  v[row.supportLevel] = 1
  if (row.hasPvc === 'yes') v.hasPvcYes = 1
  if (row.volunteer) v.volunteers = 1
  return v
}

export function statDelta(before: StatSource | null, after: StatSource | null): StatVector {
  const a = after ? statContribution(after) : null
  const b = before ? statContribution(before) : null
  return Object.fromEntries(STAT_KEYS.map(k => [k, (a?.[k] ?? 0) - (b?.[k] ?? 0)])) as StatVector
}

/**
 * Add `delta` to a PU's counters, in the caller's transaction. UPDATE first: an INSERT … ON CONFLICT would check
 * the non-negative CHECK against the proposed row, which a negative delta (an edit) fails. Insert only if missing.
 */
export async function applyStatDelta(db: DbLike, puCode: string, delta: StatVector, capturedAt?: Date): Promise<void> {
  if (STAT_KEYS.every(k => delta[k] === 0) && !capturedAt) return
  const set: Record<string, SQL> = { updatedAt: sql`now()` }
  for (const k of STAT_KEYS) set[k] = sql`${puStats[k]} + ${delta[k]}`
  if (capturedAt) set.lastCaptureAt = sql`greatest(${puStats.lastCaptureAt}, ${capturedAt.toISOString()}::timestamptz)`
  const updated = await db.update(puStats).set(set).where(eq(puStats.puCode, puCode)).returning({ puCode: puStats.puCode })
  if (updated.length > 0) return
  // First supporter on this PU (deltas are then non-negative). A concurrent first insert falls through to the update.
  await db.insert(puStats).values({ puCode, ...delta, lastCaptureAt: capturedAt ?? null }).onConflictDoUpdate({ target: puStats.puCode, set })
}

/**
 * Rebuild pu_stats from the supporter rows (and open flags) of every PU under `unitCode` ('' = everywhere).
 * For the dev seed now and the nightly reconcile (6.1). Run it inside a transaction (it deletes, then inserts).
 * Returns the number of PU rows written.
 */
export async function recomputePuStats(tx: DbLike, unitCode = ''): Promise<number> {
  const within = (col: SQL | typeof puStats.puCode) => unitCode === ''
    ? sql`true`
    : sql`(${col} ~>=~ ${unitCode} and ${col} ~<~ ${`${unitCode}0`})`
  await tx.delete(puStats).where(within(puStats.puCode))
  const rows = await tx.execute(sql`
    insert into pu_stats (pu_code, total, verified, flagged_open, male, female,
      age_18_24, age_25_34, age_35_44, age_45_54, age_55_64, age_65_plus,
      strong, leaning, undecided, has_pvc_yes, volunteers, opted_out, last_capture_at)
    select u.code,
      count(s.id),
      count(s.id) filter (where s.verification in ('sms_delivered', 'callback_verified')),
      coalesce(f.open, 0),
      count(s.id) filter (where s.gender = 'male'),
      count(s.id) filter (where s.gender = 'female'),
      count(s.id) filter (where s.age_band = '18_24'),
      count(s.id) filter (where s.age_band = '25_34'),
      count(s.id) filter (where s.age_band = '35_44'),
      count(s.id) filter (where s.age_band = '45_54'),
      count(s.id) filter (where s.age_band = '55_64'),
      count(s.id) filter (where s.age_band = '65_plus'),
      count(s.id) filter (where s.support_level = 'strong'),
      count(s.id) filter (where s.support_level = 'leaning'),
      count(s.id) filter (where s.support_level = 'undecided'),
      count(s.id) filter (where s.has_pvc = 'yes'),
      count(s.id) filter (where s.volunteer),
      count(s.id) filter (where s.verification = 'opted_out'),
      max(s.captured_at)
    from units u
    left join supporters s on s.pu_code = u.code
    left join (select pu_code, count(*)::int as open from flags where status = 'open' group by pu_code) f on f.pu_code = u.code
    where u.level = 'pu' and ${within(sql`u.code`)}
    group by u.code, f.open
    having count(s.id) > 0 or coalesce(f.open, 0) > 0
    returning pu_code`)
  return rows.length
}

// ── Serialisation (SECURITY_PRIVACY §4) ─────────────────────────────────────

/** Roles that may see full supporter details (within their scope; the caller checks scope). */
const FULL_VIEW_ROLES: readonly Role[] = ['PU_LEAD', 'WARD_LEAD']

export function nameInitials(fullName: string): string {
  return fullName.split(/\s+/).filter(Boolean).map(w => `${[...w][0]!.toUpperCase()}.`).join(' ') || '—'
}

/** The only way a supporter leaves the server: full for PU/ward leads, masked for everyone else. */
export function serializeSupporter(row: Supporter, viewerRole: Role): SupporterDto | MaskedSupporterDto {
  if (!FULL_VIEW_ROLES.includes(viewerRole)) {
    return {
      masked: true,
      id: row.id,
      puCode: row.puCode,
      initials: row.status === 'anonymised' ? '—' : nameInitials(row.fullName),
      phone: row.phone ? maskPhoneForDisplay(row.phone) : null,
      capturedAt: row.capturedAt.toISOString(),
      verification: row.verification,
      status: row.status,
    }
  }
  return {
    masked: false,
    id: row.id,
    puCode: row.puCode,
    fullName: row.fullName,
    phone: row.phone,
    sharedPhone: row.sharedPhone,
    address: row.address,
    gender: row.gender,
    ageBand: row.ageBand,
    supportLevel: row.supportLevel,
    hasPvc: row.hasPvc,
    volunteer: row.volunteer,
    consentAt: row.consentAt.toISOString(),
    consentVersion: row.consentVersion,
    consentLanguage: row.consentLanguage,
    gps: row.gps ? { lat: row.gps.lat, lng: row.gps.lng, accuracyM: row.gpsAccuracyM } : null,
    capturedAt: row.capturedAt.toISOString(),
    capturedBy: row.capturedBy,
    verification: row.verification,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ── Create ──────────────────────────────────────────────────────────────────

export type CreateRejectReason = 'invalid' | 'no_consent' | 'out_of_scope' | 'pu_inactive'
export type CreateSupporterResult
  = | { kind: 'accepted', supporter: Supporter }
    | { kind: 'duplicate', supporter: Supporter }
    | { kind: 'conflict' }
    | { kind: 'rejected', reason: CreateRejectReason }

const parseDate = (iso: string): Date | null => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Only a PU lead adds supporters, and only on their own PU (SECURITY_PRIVACY §3). */
function canCapture(caller: Caller, puCode: string): boolean {
  return caller.role === 'PU_LEAD' && caller.unitCode === puCode
}

/**
 * Insert a supporter captured on a phone. Idempotent by the client's id: the same id again is `duplicate` (same PU
 * and lead) or `conflict` (anything else), and never double-counts. The shared Zod schema (3.2) validates the input
 * shape first; this re-checks what the server must never accept.
 */
export async function createSupporter(db: Db, caller: Caller, input: SupporterInput): Promise<CreateSupporterResult> {
  if (!isValidPuCode(input.puCode) || unitLevel(input.puCode) !== 'pu' || !canCapture(caller, input.puCode)) {
    return { kind: 'rejected', reason: 'out_of_scope' }
  }
  const consentAt = parseDate(input.consentAt)
  if (!consentAt || !input.consentVersion?.trim()) return { kind: 'rejected', reason: 'no_consent' }
  const capturedAt = parseDate(input.capturedAt)
  if (!isUuidV7(input.id) || !capturedAt || !E164_NG_MOBILE.test(input.phone)) return { kind: 'rejected', reason: 'invalid' }

  return db.transaction(async (tx) => {
    const [unit] = await tx.select({ active: units.active }).from(units).where(and(eq(units.code, input.puCode), eq(units.level, 'pu')))
    if (!unit?.active) return { kind: 'rejected', reason: 'pu_inactive' } as const

    const [inserted] = await tx.insert(supporters).values({
      id: input.id,
      puCode: input.puCode,
      fullName: input.fullName.trim(),
      phone: input.phone,
      sharedPhone: input.sharedPhone,
      address: input.address?.trim() || null,
      gender: input.gender,
      ageBand: input.ageBand,
      supportLevel: input.supportLevel,
      hasPvc: input.hasPvc,
      volunteer: input.volunteer,
      consentAt,
      consentVersion: input.consentVersion.trim(),
      consentLanguage: input.consentLanguage,
      gps: input.gps ? { lat: input.gps.lat, lng: input.gps.lng } : null,
      gpsAccuracyM: input.gps?.accuracyM == null ? null : Math.round(input.gps.accuracyM),
      capturedAt,
      capturedBy: caller.id,
      deviceId: input.deviceId,
      updatedBy: caller.id,
    }).onConflictDoNothing({ target: supporters.id }).returning()

    if (!inserted) {
      const [existing] = await tx.select().from(supporters).where(eq(supporters.id, input.id))
      if (existing && existing.puCode === input.puCode && existing.capturedBy === caller.id) {
        return { kind: 'duplicate', supporter: existing } as const
      }
      return { kind: 'conflict' } as const
    }
    await applyStatDelta(tx, inserted.puCode, statContribution(inserted), inserted.capturedAt)
    return { kind: 'accepted', supporter: inserted } as const
  })
}

// ── Read / update ───────────────────────────────────────────────────────────

/** A supporter the caller may see in full, else null (unknown and out-of-scope look the same). */
export async function getSupporter(db: DbLike, caller: Caller, id: string): Promise<Supporter | null> {
  if (!isUuidV7(id) || !FULL_VIEW_ROLES.includes(caller.role) || !caller.unitCode) return null
  const [row] = await db.select().from(supporters).where(eq(supporters.id, id))
  return row && isWithin(row.puCode, caller.unitCode) ? row : null
}

export type UpdateSupporterResult
  = | { kind: 'ok', supporter: Supporter, changed: SupporterEditableField[] }
    | { kind: 'forbidden' }
    | { kind: 'anonymised' }
    | { kind: 'invalid' }

/**
 * Edit a supporter (US-8): the PU lead of the supporter's PU only. Last write wins on the server clock (ARCHITECTURE
 * §5.7). Audited with the changed field NAMES only.
 */
export async function updateSupporter(db: Db, caller: Caller, id: string, patch: SupporterPatch): Promise<UpdateSupporterResult> {
  if (patch.phone !== undefined && !E164_NG_MOBILE.test(patch.phone)) return { kind: 'invalid' }
  if (patch.fullName !== undefined && !patch.fullName.trim()) return { kind: 'invalid' }

  const result = await db.transaction(async (tx) => {
    if (!isUuidV7(id)) return { kind: 'forbidden' } as const
    const [before] = await tx.select().from(supporters).where(eq(supporters.id, id)).for('update')
    if (!before || !canCapture(caller, before.puCode)) return { kind: 'forbidden' } as const
    if (before.status === 'anonymised') return { kind: 'anonymised' } as const

    const values: Partial<Pick<Supporter, SupporterEditableField>> = {}
    for (const field of SUPPORTER_EDITABLE_FIELDS) {
      if (patch[field] === undefined) continue
      let value: unknown = patch[field]
      if (field === 'fullName') value = (value as string).trim()
      if (field === 'address') value = (value as string | null)?.trim() || null
      if (value !== before[field]) (values as Record<string, unknown>)[field] = value
    }
    const changed = Object.keys(values) as SupporterEditableField[]
    if (changed.length === 0) return { kind: 'ok', supporter: before, changed } as const

    const [after] = await tx.update(supporters)
      .set({ ...values, updatedAt: sql`now()`, updatedBy: caller.id })
      .where(eq(supporters.id, id))
      .returning()
    await applyStatDelta(tx, after!.puCode, statDelta(before, after!))
    return { kind: 'ok', supporter: after!, changed } as const
  })

  if (result.kind === 'ok' && result.changed.length > 0) {
    await recordAudit(db, { id: caller.id, role: caller.role, ip: null }, {
      action: 'supporter.update',
      targetType: 'supporter',
      targetId: id,
      scopeCode: result.supporter.puCode,
      meta: { fields: result.changed },
    })
  }
  return result
}
