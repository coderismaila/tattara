// Registered voters from the field (PRD US-24, task 3.7). INEC doesn't publish per-PU figures, so the PU lead records
// the number on the register displayed at the PU and the ward lead can correct it. Pure (DB injected).
import { and, eq, sql } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import { units } from '../db/schema/index.ts'
import type { UnitLevel } from '../../shared/constants/enums.ts'
import { MAX_REGISTERED_VOTERS } from '../../shared/schemas/units.ts'
import type { SessionUser } from '../../shared/types/auth.ts'
import { isValidPuCode, isWithin, unitLevel } from '../../shared/utils/pu-code.ts'
import { recordAudit } from './audit.ts'

type Caller = Pick<SessionUser, 'id' | 'role' | 'unitCode'>

export interface RegisteredVotersSummary {
  /** Unit code; `''` for the whole region. */
  code: string
  level: UnitLevel | 'region'
  /** PU: its figure. Above: the sum over PUs that have one. NULL when none has. */
  registeredVoters: number | null
  /** PU only: when a lead last reported it (NULL for an imported figure or none). */
  reportedAt: string | null
  /** PUs with a figure, and all active PUs in the unit ("reported for X of Y"). */
  pusWithFigure: number
  totalPus: number
}

/** Who may set a PU's figure: its own PU lead, or the lead of the ward it's in. */
export function canSetRegisteredVoters(caller: Caller, puCode: string): boolean {
  if (!isValidPuCode(puCode) || unitLevel(puCode) !== 'pu' || !caller.unitCode) return false
  if (caller.role === 'PU_LEAD') return caller.unitCode === puCode
  if (caller.role === 'WARD_LEAD') return isWithin(puCode, caller.unitCode)
  return false
}

export type SetRegisteredVotersResult
  = | { kind: 'ok', summary: RegisteredVotersSummary }
    | { kind: 'forbidden' }
    | { kind: 'not_found' }
    | { kind: 'invalid' }

/** Record a PU's registered-voter figure (who and when), audited with the old and new numbers. */
export async function setRegisteredVoters(db: Db, caller: Caller, puCode: string, count: number): Promise<SetRegisteredVotersResult> {
  if (!Number.isInteger(count) || count < 0 || count > MAX_REGISTERED_VOTERS) return { kind: 'invalid' }
  if (!canSetRegisteredVoters(caller, puCode)) return { kind: 'forbidden' }

  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select({ registeredVoters: units.registeredVoters }).from(units)
      .where(and(eq(units.code, puCode), eq(units.level, 'pu'), eq(units.active, true))).for('update')
    if (!before) return { found: false } as const
    await tx.update(units).set({
      registeredVoters: count,
      registeredVotersReportedBy: caller.id,
      registeredVotersReportedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(eq(units.code, puCode))
    // The previous figure may itself be NULL (a first report): keep "not found" separate from it.
    return { found: true, from: before.registeredVoters } as const
  })
  if (!result.found) return { kind: 'not_found' }

  await recordAudit(db, { id: caller.id, role: caller.role, ip: null }, {
    action: 'unit.registered_voters',
    targetType: 'unit',
    targetId: puCode,
    scopeCode: puCode,
    meta: { from: result.from, to: count },
  })
  return { kind: 'ok', summary: (await registeredVotersSummary(db, puCode))! }
}

/**
 * The figure for a PU, or the sum and "X of Y" coverage for a ward, LGA, state or the region (`''`).
 * Aggregates only: callers check scope first (the route uses requireScope).
 */
export async function registeredVotersSummary(db: DbLike, code: string): Promise<RegisteredVotersSummary | null> {
  if (code !== '' && !isValidPuCode(code)) return null

  if (code !== '' && unitLevel(code) === 'pu') {
    const [pu] = await db.select({
      registeredVoters: units.registeredVoters,
      reportedAt: units.registeredVotersReportedAt,
    }).from(units).where(and(eq(units.code, code), eq(units.level, 'pu')))
    if (!pu) return null
    return {
      code,
      level: 'pu',
      registeredVoters: pu.registeredVoters,
      reportedAt: pu.reportedAt?.toISOString() ?? null,
      pusWithFigure: pu.registeredVoters === null ? 0 : 1,
      totalPus: 1,
    }
  }

  if (code !== '') {
    const [unit] = await db.select({ level: units.level }).from(units).where(eq(units.code, code))
    if (!unit) return null
  }
  const within = code === '' ? sql`true` : sql`(${units.code} ~>=~ ${code} and ${units.code} ~<~ ${`${code}0`})`
  const [row] = await db.select({
    sum: sql<number | null>`sum(${units.registeredVoters})::int`,
    withFigure: sql<number>`count(${units.registeredVoters})::int`,
    total: sql<number>`count(*)::int`,
  }).from(units).where(and(eq(units.level, 'pu'), eq(units.active, true), within))
  return {
    code,
    level: code === '' ? 'region' : unitLevel(code)!,
    registeredVoters: row?.sum ?? null,
    reportedAt: null,
    pusWithFigure: row?.withFigure ?? 0,
    totalPus: row?.total ?? 0,
  }
}
