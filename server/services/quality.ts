// Lead quality (PRD R-7, task 5.5, ADR-044): every night, count per PU the supporters received in the last 90 days
// (verified, opted out), their open or confirmed flags and answered call-backs; roll the counts up to ward, LGA and
// state; score each unit (shared/utils/quality.ts) and replace unit_quality. Pure (DB injected).
import { inArray, sql } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import { unitQuality, type UnitQuality } from '../db/schema/index.ts'
import { QUALITY_WINDOW_DAYS, qualityScore, rollUpCodes, type QualityCounts } from '../../shared/utils/quality.ts'

const INSERT_CHUNK = 1000

/** Rebuild unit_quality from scratch. Returns the number of units scored. */
export async function computeQuality(db: Db, windowDays = QUALITY_WINDOW_DAYS): Promise<number> {
  const since = sql`now() - ${windowDays} * interval '1 day'`
  const rows = await db.execute<{ pu_code: string, supporters: number, verified: number, opted_out: number, flags: number, calls_verified: number, calls_failed: number }>(sql`
    with s as (
      select pu_code, count(*)::int as supporters,
        count(*) filter (where verification in ('sms_delivered', 'callback_verified'))::int as verified,
        count(*) filter (where verification = 'opted_out')::int as opted_out
      from supporters where created_at > ${since}
      group by pu_code
    ),
    f as (
      select pu_code, count(*)::int as flags
      from flags where status in ('open', 'confirmed') and created_at > ${since}
      group by pu_code
    ),
    c as (
      select sp.pu_code,
        count(*) filter (where cb.outcome = 'verified')::int as calls_verified,
        count(*) filter (where cb.outcome in ('wrong_number', 'denies'))::int as calls_failed
      from callbacks cb join supporters sp on sp.id = cb.supporter_id
      where cb.completed_at > ${since}
      group by sp.pu_code
    )
    select s.pu_code, s.supporters, s.verified, s.opted_out,
      coalesce(f.flags, 0) as flags, coalesce(c.calls_verified, 0) as calls_verified, coalesce(c.calls_failed, 0) as calls_failed
    from s left join f on f.pu_code = s.pu_code left join c on c.pu_code = s.pu_code`)

  const totals = new Map<string, QualityCounts>()
  for (const r of rows) {
    for (const code of rollUpCodes(r.pu_code)) {
      const t = totals.get(code) ?? { supporters: 0, verified: 0, flags: 0, optedOut: 0, callsVerified: 0, callsFailed: 0 }
      t.supporters += r.supporters
      t.verified += r.verified
      t.flags += r.flags
      t.optedOut += r.opted_out
      t.callsVerified += r.calls_verified
      t.callsFailed += r.calls_failed
      totals.set(code, t)
    }
  }

  const values = [...totals].map(([unitCode, counts]) => ({ unitCode, ...qualityScore(counts) }))
  await db.transaction(async (tx) => {
    await tx.delete(unitQuality)
    for (let i = 0; i < values.length; i += INSERT_CHUNK) {
      await tx.insert(unitQuality).values(values.slice(i, i + INSERT_CHUNK))
    }
  })
  return values.length
}

/** Stored quality for these units (missing = no supporters in the window). */
export async function qualityFor(db: DbLike, unitCodes: readonly string[]): Promise<Map<string, UnitQuality>> {
  if (!unitCodes.length) return new Map()
  const rows = await db.select().from(unitQuality).where(inArray(unitQuality.unitCode, [...unitCodes]))
  return new Map(rows.map(r => [r.unitCode, r]))
}
