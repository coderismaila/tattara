// Dashboard aggregates (ARCHITECTURE §7, task 6.1, ADR-045): roll pu_stats up to any unit with a prefix GROUP BY over
// the ~42k PUs, plus registered voters (coverage skips PUs without a figure, ADR-033), targets, active leads and the
// daily snapshot. Aggregates only. Pure (DB injected); the routes cache the results for 60 s.
import { and, asc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import { unitDailyStats, unitTargets, units } from '../db/schema/index.ts'
import type { UnitLevel } from '../../shared/constants/enums.ts'
import type { ChildMetric, ChildStats, ChildrenStats, UnitStats } from '../../shared/types/stats.ts'
import { addDays, lagosDate } from '../../shared/utils/lagos-date.ts'
import { unitLevel } from '../../shared/utils/pu-code.ts'
import { recomputePuStats } from './supporters.ts'

/** The snapshot key for the region. */
export const REGION_KEY = 'all'
/** Length of a child's code below each level ('' = region → states). */
export const CHILD_CODE_LENGTH: Record<UnitLevel | 'region', number | null> = { region: 2, state: 5, lga: 8, ward: 12, pu: null }
const CHILD_LEVEL: Record<UnitLevel | 'region', UnitLevel | null> = { region: 'state', state: 'lga', lga: 'ward', ward: 'pu', pu: null }

const levelOf = (code: string): UnitLevel | 'region' => (code === '' ? 'region' : unitLevel(code)!)
const ratio = (n: number, d: number | null): number | null => (d ? n / d : null)

/** PU rows under `code` (the unit itself for a PU; '' = everywhere). */
const puUnder = (code: string): SQL => code === ''
  ? sql`true`
  : sql`(u.code ~>=~ ${code} and u.code ~<~ ${`${code}0`})`

/** Supporters on PUs with a figure ÷ those figures. */
export function coverageOf(coveredSupporters: number, voters: number | null): number | null {
  return voters ? coveredSupporters / voters : null
}

/** Sort children by a metric; units without a value go last whatever the direction. Stable on code. */
export function sortChildren(rows: ChildStats[], metric: ChildMetric, sort: 'asc' | 'desc'): ChildStats[] {
  const value = (r: ChildStats): number | null => metric === 'supporters' ? r.supporters : r[metric]
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null || vb === null) return va === vb ? a.code.localeCompare(b.code) : va === null ? 1 : -1
    return (sort === 'asc' ? va - vb : vb - va) || a.code.localeCompare(b.code)
  })
}

export type Rollup = {
  code: string
  supporters: number
  verified: number
  flagged_open: number
  covered: number
  voters: number | null
  pus_with_figure: number
  total_pus: number
}

/** pu_stats + registered voters rolled up to codes of length `len` under `code` (len 0 = one row for the region). */
export async function rollup(db: DbLike, code: string, len: number): Promise<Rollup[]> {
  const key = len === 0 ? sql`''` : sql`left(u.code, ${len})`
  return db.execute<Rollup>(sql`
    select ${key} as code,
      coalesce(sum(p.total), 0)::int as supporters,
      coalesce(sum(p.verified), 0)::int as verified,
      coalesce(sum(p.flagged_open), 0)::int as flagged_open,
      coalesce(sum(p.total) filter (where u.registered_voters is not null), 0)::int as covered,
      sum(u.registered_voters)::int as voters,
      count(u.registered_voters) filter (where u.active)::int as pus_with_figure,
      count(*) filter (where u.active)::int as total_pus
    from units u left join pu_stats p on p.pu_code = u.code
    where u.level = 'pu' and ${puUnder(code)}
    group by 1`) as unknown as Promise<Rollup[]>
}

export async function targetsFor(db: DbLike, codes: string[]): Promise<Map<string, number>> {
  if (!codes.length) return new Map()
  const rows = await db.select({ code: unitTargets.unitCode, target: unitTargets.target }).from(unitTargets).where(inArray(unitTargets.unitCode, codes))
  return new Map(rows.map(r => [r.code, r.target]))
}

/** The whole unit's numbers. NULL for an unknown code. */
export async function unitStats(db: DbLike, code: string): Promise<UnitStats | null> {
  let unit: UnitStats['unit'] = { code: '', name: '', level: 'region' }
  if (code !== '') {
    const [row] = await db.select({ code: units.code, name: units.name, level: units.level }).from(units).where(eq(units.code, code))
    if (!row) return null
    unit = row
  }

  const [row] = await db.execute<Record<string, number | string | null>>(sql`
    select
      coalesce(sum(p.total), 0)::int as supporters, coalesce(sum(p.verified), 0)::int as verified,
      coalesce(sum(p.flagged_open), 0)::int as flagged_open, coalesce(sum(p.opted_out), 0)::int as opted_out,
      coalesce(sum(p.volunteers), 0)::int as volunteers, coalesce(sum(p.has_pvc_yes), 0)::int as has_pvc_yes,
      coalesce(sum(p.strong), 0)::int as strong, coalesce(sum(p.leaning), 0)::int as leaning,
      coalesce(sum(p.undecided), 0)::int as undecided, coalesce(sum(p.male), 0)::int as male,
      coalesce(sum(p.female), 0)::int as female,
      coalesce(sum(p.age_18_24), 0)::int as a1, coalesce(sum(p.age_25_34), 0)::int as a2, coalesce(sum(p.age_35_44), 0)::int as a3,
      coalesce(sum(p.age_45_54), 0)::int as a4, coalesce(sum(p.age_55_64), 0)::int as a5, coalesce(sum(p.age_65_plus), 0)::int as a6,
      coalesce(sum(p.total) filter (where u.registered_voters is not null), 0)::int as covered,
      sum(u.registered_voters)::int as voters,
      count(u.registered_voters) filter (where u.active)::int as pus_with_figure,
      count(*) filter (where u.active)::int as total_pus,
      to_char(max(p.last_capture_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_capture_at
    from units u left join pu_stats p on p.pu_code = u.code
    where u.level = 'pu' and ${puUnder(code)}`)
  const n = (k: string) => Number(row?.[k] ?? 0)
  const voters = row?.voters === null || row?.voters === undefined ? null : Number(row.voters)
  const target = code === '' ? null : (await targetsFor(db, [code])).get(code) ?? null

  const since = addDays(lagosDate(), -30)
  const series = await db.select({ day: unitDailyStats.day, total: unitDailyStats.total, verified: unitDailyStats.verified })
    .from(unitDailyStats)
    .where(and(eq(unitDailyStats.unitCode, code === '' ? REGION_KEY : code), gte(unitDailyStats.day, since)))
    .orderBy(asc(unitDailyStats.day))

  return {
    unit,
    totals: {
      supporters: n('supporters'),
      verified: n('verified'),
      flaggedOpen: n('flagged_open'),
      optedOut: n('opted_out'),
      volunteers: n('volunteers'),
      hasPvcYes: n('has_pvc_yes'),
      support: { strong: n('strong'), leaning: n('leaning'), undecided: n('undecided') },
      gender: { male: n('male'), female: n('female') },
      age: { '18_24': n('a1'), '25_34': n('a2'), '35_44': n('a3'), '45_54': n('a4'), '55_64': n('a5'), '65_plus': n('a6') },
    },
    registeredVoters: { sum: voters, pusWithFigure: n('pus_with_figure'), totalPus: n('total_pus') },
    coverage: coverageOf(n('covered'), voters),
    target,
    progress: ratio(n('supporters'), target),
    lastCaptureAt: (row?.last_capture_at as string | null) ?? null,
    last30Days: series,
    computedAt: new Date().toISOString(),
  }
}

/** One row per child unit (states for the region), sorted by `metric`. NULL for an unknown code; [] below a PU. */
export async function childrenStats(db: DbLike, code: string, metric: ChildMetric = 'coverage', sort: 'asc' | 'desc' = 'asc'): Promise<ChildrenStats | null> {
  const level = levelOf(code)
  if (code !== '') {
    const [exists] = await db.select({ code: units.code }).from(units).where(eq(units.code, code))
    if (!exists) return null
  }
  const len = CHILD_CODE_LENGTH[level]
  const childLevel = CHILD_LEVEL[level]
  const base = { unit: { code, level }, metric, sort, computedAt: new Date().toISOString() }
  if (len === null || childLevel === null) return { ...base, children: [] }

  const [rows, kids] = await Promise.all([
    rollup(db, code, len),
    db.select({ code: units.code, name: units.name }).from(units)
      .where(and(eq(units.level, childLevel), eq(units.active, true), code === '' ? sql`true` : eq(units.parentCode, code))),
  ])
  const byCode = new Map(rows.map(r => [r.code, r]))
  const codes = kids.map(k => k.code)
  const [targets, leads] = await Promise.all([
    targetsFor(db, codes),
    db.execute<{ code: string, n: number }>(sql`
      select left(unit_code, ${len}) as code, count(*)::int as n from users
      where status = 'active' and unit_code is not null and length(unit_code) >= ${len}
        and ${code === '' ? sql`true` : sql`(unit_code ~>=~ ${code} and unit_code ~<~ ${`${code}0`})`}
      group by 1`),
  ])
  const leadsByCode = new Map((leads as unknown as { code: string, n: number }[]).map(l => [l.code, l.n]))

  const children: ChildStats[] = kids.map((k) => {
    const r = byCode.get(k.code)
    const supporters = r?.supporters ?? 0
    const voters = r?.voters ?? null
    const target = targets.get(k.code) ?? null
    return {
      code: k.code,
      name: k.name,
      level: childLevel,
      supporters,
      verified: r?.verified ?? 0,
      verifiedRate: ratio(r?.verified ?? 0, supporters),
      flaggedOpen: r?.flagged_open ?? 0,
      registeredVoters: { sum: voters, pusWithFigure: r?.pus_with_figure ?? 0, totalPus: r?.total_pus ?? 0 },
      coverage: coverageOf(r?.covered ?? 0, voters),
      target,
      progress: ratio(supporters, target),
      activeLeads: leadsByCode.get(k.code) ?? 0,
    }
  })
  return { ...base, children: sortChildren(children, metric, sort) }
}

/**
 * The nightly snapshot (`stats:daily`, 23:55 Lagos): today's cumulative total and verified count for every unit with
 * supporters, at every level, and the region. Re-running the same day overwrites. Returns the rows written.
 */
export async function writeDailyStats(db: Db, day = lagosDate()): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    with pu as (
      select u.code, coalesce(p.total, 0) as total, coalesce(p.verified, 0) as verified
      from units u join pu_stats p on p.pu_code = u.code
      where u.level = 'pu' and p.total > 0
    ),
    rolled as (
      select code as unit_code, total, verified from pu
      union all select left(code, 8), sum(total), sum(verified) from pu group by 1
      union all select left(code, 5), sum(total), sum(verified) from pu group by 1
      union all select left(code, 2), sum(total), sum(verified) from pu group by 1
      union all select ${REGION_KEY}, coalesce(sum(total), 0), coalesce(sum(verified), 0) from pu
    )
    insert into unit_daily_stats (unit_code, day, total, verified)
    select unit_code, ${day}::date, total::int, verified::int from rolled
    on conflict (unit_code, day) do update set total = excluded.total, verified = excluded.verified
    returning 1 as n`)
  return rows.length
}

/**
 * The nightly reconcile (`stats:reconcile`): compare pu_stats with a fresh count from the supporter rows, and rebuild
 * it if any PU drifted. Returns the PUs that differed (should be 0: every write keeps pu_stats in step).
 */
export async function reconcilePuStats(db: Db): Promise<{ drifted: number, sample: string[] }> {
  const drift = await db.execute<{ pu_code: string }>(sql`
    with fresh as (
      select s.pu_code, count(*)::int as total,
        count(*) filter (where s.verification in ('sms_delivered', 'callback_verified'))::int as verified,
        count(*) filter (where s.verification = 'opted_out')::int as opted_out,
        count(*) filter (where s.support_level = 'strong')::int as strong
      from supporters s group by s.pu_code
    ),
    open_flags as (select pu_code, count(*)::int as n from flags where status = 'open' group by pu_code)
    select coalesce(f.pu_code, p.pu_code) as pu_code
    from fresh f
    full join pu_stats p on p.pu_code = f.pu_code
    left join open_flags o on o.pu_code = coalesce(f.pu_code, p.pu_code)
    where coalesce(f.total, 0) <> coalesce(p.total, 0)
      or coalesce(f.verified, 0) <> coalesce(p.verified, 0)
      or coalesce(f.opted_out, 0) <> coalesce(p.opted_out, 0)
      or coalesce(f.strong, 0) <> coalesce(p.strong, 0)
      or coalesce(o.n, 0) <> coalesce(p.flagged_open, 0)`)
  const codes = (drift as unknown as { pu_code: string }[]).map(r => r.pu_code)
  if (codes.length) await db.transaction(tx => recomputePuStats(tx))
  return { drifted: codes.length, sample: codes.slice(0, 10) }
}
