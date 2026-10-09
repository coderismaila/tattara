// Leaderboard and inactive leads (task 6.5, PRD US-14, ADR-049). The leaderboard ranks the units at one level below a
// unit, by default on supporters captured in the last 7 days (registered-voter figures and targets are still sparse).
// Inactive leads: active PU leads with no captures in N days, plus leads invited but never set up. Lead names only,
// never phone numbers. Pure (DB injected); the routes check scope and cache for 60 s.
import { sql, type SQL } from 'drizzle-orm'
import type { DbLike } from '../db/client.ts'
import type { UnitLevel } from '../../shared/constants/enums.ts'
import {
  LEADERBOARD_WINDOW_DAYS,
  type InactiveLead,
  type InactiveLeads,
  type Leaderboard,
  type LeaderboardMetric,
  type LeaderboardRow,
  type NotStartedLead,
} from '../../shared/types/stats.ts'
import { unitLevel } from '../../shared/utils/pu-code.ts'
import { coverageOf, rollup } from './stats.ts'

const DEPTH: Record<UnitLevel | 'region', number> = { region: 0, state: 1, lga: 2, ward: 3, pu: 4 }
const CODE_LENGTH: Record<UnitLevel, number> = { state: 2, lga: 5, ward: 8, pu: 12 }
const NEXT_LEVEL: Record<UnitLevel | 'region', UnitLevel | null> = { region: 'state', state: 'lga', lga: 'ward', ward: 'pu', pu: null }
/** Most leads returned per list; the totals still count all of them. */
export const INACTIVE_LIST_MAX = 200
const DAY_MS = 24 * 60 * 60 * 1000

const levelOf = (code: string): UnitLevel | 'region' => (code === '' ? 'region' : unitLevel(code)!)

/** Codes under `code` ('' = everywhere), as a range the text_pattern_ops index can use. */
const under = (column: SQL, code: string): SQL => code === ''
  ? sql`true`
  : sql`(${column} ~>=~ ${code} and ${column} ~<~ ${`${code}0`})`

/** The level a leaderboard shows: `requested` if strictly below the unit, the next one down if omitted, else null. */
export function leaderboardLevel(code: string, requested?: UnitLevel): UnitLevel | null {
  const own = levelOf(code)
  if (requested === undefined) return NEXT_LEVEL[own]
  return DEPTH[requested] > DEPTH[own] ? requested : null
}

type Unranked = Omit<LeaderboardRow, 'rank' | 'value'>

const metricValue = (r: Unranked, metric: LeaderboardMetric): number | null =>
  metric === 'recent' ? r.recent : r[metric]

/** Highest first; no value last; ties on total supporters, then code. Ranks are 1…n in that order. */
export function rankRows(rows: readonly Unranked[], metric: LeaderboardMetric): LeaderboardRow[] {
  return rows
    .map(r => ({ ...r, value: metricValue(r, metric) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value !== b.value) return a.value === null ? 1 : -1
      }
      else if (a.value !== b.value) {
        return b.value - a.value
      }
      return b.supporters - a.supporters || a.code.localeCompare(b.code)
    })
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/** null = unknown unit; 'bad_level' = the level isn't below the unit. */
export async function leaderboard(
  db: DbLike, code: string, requestedLevel: UnitLevel | undefined, metric: LeaderboardMetric, limit: number,
): Promise<Leaderboard | null | 'bad_level'> {
  if (code !== '') {
    const [exists] = await db.execute<{ code: string }>(sql`select code from units where code = ${code}`) as unknown as { code: string }[]
    if (!exists) return null
  }
  const level = leaderboardLevel(code, requestedLevel)
  if (!level) return 'bad_level'
  const len = CODE_LENGTH[level]

  const [totals, recent, names, targets] = await Promise.all([
    rollup(db, code, len),
    db.execute<{ code: string, n: number }>(sql`
      select left(s.pu_code, ${len}) as code, count(*)::int as n from supporters s
      where ${under(sql`s.pu_code`, code)} and s.captured_at >= now() - make_interval(days => ${LEADERBOARD_WINDOW_DAYS})
      group by 1`),
    db.execute<{ code: string, name: string }>(sql`
      select u.code, u.name from units u where u.level = ${level} and u.active and ${under(sql`u.code`, code)}`),
    db.execute<{ code: string, target: number }>(sql`
      select t.unit_code as code, t.target from unit_targets t join units u on u.code = t.unit_code
      where u.level = ${level} and ${under(sql`t.unit_code`, code)}`),
  ])
  const totalBy = new Map(totals.map(r => [r.code, r]))
  const recentBy = new Map((recent as unknown as { code: string, n: number }[]).map(r => [r.code, r.n]))
  const targetBy = new Map((targets as unknown as { code: string, target: number }[]).map(r => [r.code, r.target]))

  const rows: Unranked[] = (names as unknown as { code: string, name: string }[]).map((u) => {
    const r = totalBy.get(u.code)
    const supporters = r?.supporters ?? 0
    const target = targetBy.get(u.code) ?? null
    return {
      code: u.code,
      name: u.name,
      recent: recentBy.get(u.code) ?? 0,
      supporters,
      progress: target ? supporters / target : null,
      coverage: coverageOf(r?.covered ?? 0, r?.voters ?? null),
    }
  })
  const ranked = rankRows(rows, metric)
  return {
    unit: { code, level: levelOf(code) },
    level,
    metric,
    total: ranked.length,
    rows: ranked.slice(0, limit),
    computedAt: new Date().toISOString(),
  }
}

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString())
const wholeDays = (from: Date | string, now: Date): number => Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / DAY_MS))

/**
 * Active PU leads under `code` with no capture in `days` days, counted from their last capture or, without one, from
 * setting up (so a lead who joined yesterday isn't inactive yet); longest first. And leads invited below the caller's
 * unit who never set up, oldest invite first. null = unknown unit.
 */
export async function inactiveLeads(db: DbLike, code: string, days: number, now = new Date()): Promise<InactiveLeads | null> {
  if (code !== '') {
    const [exists] = await db.execute<{ code: string }>(sql`select code from units where code = ${code}`) as unknown as { code: string }[]
    if (!exists) return null
  }
  const cutoff = new Date(now.getTime() - days * DAY_MS)

  const [inactive, notStarted] = await Promise.all([
    db.execute<{ id: string, name: string, unit_code: string, unit_name: string, last_seen_at: Date | null, last_capture_at: Date | null, since: Date, total: number }>(sql`
      with leads as (
        select u.id, u.full_name as name, u.unit_code, un.name as unit_name, u.last_seen_at, lc.at as last_capture_at,
          coalesce(lc.at, (select max(i.used_at) from invites i where i.user_id = u.id), u.created_at) as since
        from users u
        join units un on un.code = u.unit_code
        left join lateral (
          select s.captured_at as at from supporters s where s.captured_by = u.id order by s.captured_at desc limit 1
        ) lc on true
        where u.role = 'PU_LEAD' and u.status = 'active' and ${under(sql`u.unit_code`, code)}
      )
      select *, count(*) over ()::int as total from leads where since < ${cutoff.toISOString()}::timestamptz
      order by since asc, unit_code
      limit ${INACTIVE_LIST_MAX}`),
    db.execute<{ id: string, name: string, role: string, unit_code: string, unit_name: string, invited_at: Date, total: number }>(sql`
      select u.id, u.full_name as name, u.role, u.unit_code, un.name as unit_name,
        coalesce((select max(i.created_at) from invites i where i.user_id = u.id), u.created_at) as invited_at,
        count(*) over ()::int as total
      from users u join units un on un.code = u.unit_code
      where u.status = 'invited' and ${under(sql`u.unit_code`, code)} and u.unit_code <> ${code}
      order by invited_at asc, u.unit_code
      limit ${INACTIVE_LIST_MAX}`),
  ])
  const inactiveRows = inactive as unknown as { id: string, name: string, unit_code: string, unit_name: string, last_seen_at: Date | null, last_capture_at: Date | null, since: Date, total: number }[]
  const notStartedRows = notStarted as unknown as { id: string, name: string, role: string, unit_code: string, unit_name: string, invited_at: Date, total: number }[]

  return {
    unit: { code, level: levelOf(code) },
    days,
    inactive: inactiveRows.map((r): InactiveLead => ({
      userId: r.id,
      name: r.name,
      unitCode: r.unit_code,
      unitName: r.unit_name,
      lastCaptureAt: iso(r.last_capture_at),
      lastSeenAt: iso(r.last_seen_at),
      daysInactive: wholeDays(r.since, now),
    })),
    inactiveTotal: inactiveRows[0]?.total ?? 0,
    notStarted: notStartedRows.map((r): NotStartedLead => ({
      userId: r.id,
      name: r.name,
      role: r.role,
      unitCode: r.unit_code,
      unitName: r.unit_name,
      invitedAt: iso(r.invited_at)!,
      daysSinceInvite: wholeDays(r.invited_at, now),
    })),
    notStartedTotal: notStartedRows[0]?.total ?? 0,
    computedAt: now.toISOString(),
  }
}
