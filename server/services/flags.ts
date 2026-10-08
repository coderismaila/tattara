// The flag engine (PRD R-6, task 5.1, ADR-040): data-quality checks that raise flags for review and never block a save.
// Each check is one set-based INSERT … SELECT, run for the supporters a sync just accepted (or a phone edit) and, every
// night, for everything. Pure (DB injected); reads supporters directly, which only services/ may do.
// Flag details are evidence only (distances, counts, ratios): never names, phone numbers or coordinates.
import { sql, type SQL } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import {
  DEFAULT_GPS_FLAG_METERS,
  GPS_CLUSTER_MIN,
  PU_CAPACITY_RATIO,
  RATE_ANOMALY_PER_HOUR,
  gpsFarThreshold,
} from '../../shared/constants/flags.ts'

export interface FlagCheckOptions {
  /** Only these supporters (and the PUs and leads they belong to). Omitted = everything (nightly). */
  supporterIds?: readonly string[]
  /** runtimeConfig.public.gpsFlagMeters */
  gpsFlagMeters?: number
}

export const FLAG_CHECKS = ['gps_far', 'duplicate_phone', 'pu_over_capacity', 'rate_anomaly', 'gps_cluster'] as const
export type FlagCheckType = typeof FLAG_CHECKS[number]
/** New flags raised by each check. */
export type FlagCheckResult = Record<FlagCheckType, number>

/** Latitude/longitude rounded to 6 decimals (~0.1 m): "the same fix". */
const exactLat = (col: SQL) => sql`round(ST_Y(${col}::geometry)::numeric, 6)`
const exactLng = (col: SQL) => sql`round(ST_X(${col}::geometry)::numeric, 6)`

/**
 * Run every check. Things already flagged are skipped, and a supporter's flag that was reviewed (dismissed or
 * confirmed) is never raised again for the same type. Updates pu_stats.flagged_open for the PUs that got new flags.
 */
export async function runFlagChecks(db: Db, options: FlagCheckOptions = {}): Promise<FlagCheckResult> {
  const result: FlagCheckResult = { gps_far: 0, duplicate_phone: 0, pu_over_capacity: 0, rate_anomaly: 0, gps_cluster: 0 }
  const ids = options.supporterIds
  if (ids && ids.length === 0) return result
  const near = gpsFarThreshold(options.gpsFlagMeters ?? DEFAULT_GPS_FLAG_METERS, false)
  const estimated = gpsFarThreshold(near, true)

  /** The given supporters (everything when running for everything). */
  const onlyIds = ids ? sql`s.id in ${ids}` : sql`true`
  /** PUs / leads of the given supporters. */
  const theirPus = ids ? sql`s.pu_code in (select pu_code from supporters where id in ${ids})` : sql`true`
  const theirLeads = ids ? sql`s.captured_by in (select captured_by from supporters where id in ${ids})` : sql`true`

  return db.transaction(async (tx) => {
    const touched = new Set<string>()
    const run = async (type: FlagCheckType, query: SQL) => {
      const rows = await tx.execute<{ pu_code: string }>(query)
      for (const r of rows) touched.add(r.pu_code)
      result[type] = rows.length
    }

    // GPS far from the PU, after allowing for the fix's reported accuracy; a wider limit for estimated PU locations.
    await run('gps_far', sql`
      insert into flags (id, supporter_id, pu_code, type, details)
      select gen_random_uuid(), s.id, s.pu_code, 'gps_far', jsonb_build_object(
        'distanceM', round(d.dist)::int, 'accuracyM', s.gps_accuracy_m, 'thresholdM', d.threshold,
        'puLocationEstimated', u.location_estimated)
      from supporters s
      join units u on u.code = s.pu_code
      cross join lateral (select ST_Distance(s.gps, u.location) as dist,
        case when u.location_estimated then ${estimated}::int else ${near}::int end as threshold) d
      where s.status <> 'anonymised' and s.gps is not null and u.location is not null
        and d.dist - coalesce(s.gps_accuracy_m, 0) > d.threshold
        and ${onlyIds}
        and not exists (select 1 from flags f where f.supporter_id = s.id and f.type = 'gps_far')
      on conflict do nothing
      returning pu_code`)

    // Second and later uses of a phone number (the earliest record is not flagged). Never says where the others are.
    await run('duplicate_phone', sql`
      insert into flags (id, supporter_id, pu_code, type, details)
      select gen_random_uuid(), s.id, s.pu_code, 'duplicate_phone', jsonb_build_object(
        'uses', p.uses, 'samePu', p.same_pu, 'sharedPhone', s.shared_phone)
      from supporters s
      cross join lateral (
        select count(*)::int as uses,
          count(*) filter (where (o.created_at, o.id) < (s.created_at, s.id))::int as earlier,
          coalesce(bool_or(o.pu_code = s.pu_code and (o.created_at, o.id) < (s.created_at, s.id)), false) as same_pu
        from supporters o where o.phone = s.phone) p
      where s.phone is not null and s.status <> 'anonymised' and p.earlier > 0
        and ${onlyIds}
        and not exists (select 1 from flags f where f.supporter_id = s.id and f.type = 'duplicate_phone')
      on conflict do nothing
      returning pu_code`)

    // More supporters than 90% of the PU's registered voters. PUs without a figure are skipped (ADR-033). A reviewed
    // flag stays reviewed until the figure changes.
    await run('pu_over_capacity', sql`
      insert into flags (id, pu_code, type, details)
      select gen_random_uuid(), u.code, 'pu_over_capacity', jsonb_build_object(
        'supporters', c.n, 'registeredVoters', u.registered_voters, 'ratio', ${PU_CAPACITY_RATIO}::numeric)
      from (select s.pu_code, count(*)::int as n from supporters s where ${theirPus} group by s.pu_code) c
      join units u on u.code = c.pu_code
      where u.registered_voters is not null and c.n > u.registered_voters * ${PU_CAPACITY_RATIO}::numeric
        and not exists (select 1 from flags f
          where f.pu_code = u.code and f.type = 'pu_over_capacity' and f.supporter_id is null and f.user_id is null
            and (f.status = 'open' or (f.details->>'registeredVoters')::int = u.registered_voters))
      on conflict do nothing
      returning pu_code`)

    // More than 60 captures by one lead in any rolling hour (device clock: the server's receive time would turn every
    // offline sync into a burst). One flag per lead: the busiest hour that starts after any burst already reviewed.
    await run('rate_anomaly', sql`
      with reviewed as (
        select f.user_id, max((f.details->>'windowEnd')::timestamptz) as until
        from flags f where f.type = 'rate_anomaly' and f.supporter_id is null and f.user_id is not null
        group by f.user_id
      ),
      w as (
        select s.captured_by, s.pu_code, s.captured_at,
          count(*) over (partition by s.captured_by order by s.captured_at
            range between interval '1 hour' preceding and current row)::int as n
        from supporters s where ${theirLeads}
      ),
      peak as (
        select distinct on (w.captured_by) w.captured_by, w.pu_code, w.captured_at as window_end, w.n
        from w left join reviewed r on r.user_id = w.captured_by
        -- Only hours that start after the reviewed burst ended: its own later windows are the same burst.
        where w.n > ${RATE_ANOMALY_PER_HOUR}::int and w.captured_at - interval '1 hour' >= coalesce(r.until, '-infinity'::timestamptz)
        order by w.captured_by, w.n desc, w.captured_at
      )
      insert into flags (id, user_id, pu_code, type, details)
      select gen_random_uuid(), p.captured_by, p.pu_code, 'rate_anomaly', jsonb_build_object(
        'count', p.n, 'limit', ${RATE_ANOMALY_PER_HOUR}::int,
        'windowStart', p.window_end - interval '1 hour', 'windowEnd', p.window_end)
      from peak p
      where not exists (select 1 from flags f
        where f.user_id = p.captured_by and f.type = 'rate_anomaly' and f.supporter_id is null and f.status = 'open')
      on conflict do nothing
      returning pu_code`)

    // Many supporters from one lead with exactly the same GPS fix: a stuck or invented location.
    await run('gps_cluster', sql`
      with c as (
        select s.captured_by, ${exactLat(sql`s.gps`)} as lat, ${exactLng(sql`s.gps`)} as lng, count(*)::int as n
        from supporters s
        where s.gps is not null and s.status <> 'anonymised' and ${theirLeads}
        group by 1, 2, 3
        having count(*) >= ${GPS_CLUSTER_MIN}::int
      )
      insert into flags (id, supporter_id, pu_code, type, details)
      select gen_random_uuid(), s.id, s.pu_code, 'gps_cluster', jsonb_build_object('clusterSize', c.n)
      from supporters s
      join c on c.captured_by = s.captured_by and c.lat = ${exactLat(sql`s.gps`)} and c.lng = ${exactLng(sql`s.gps`)}
      where s.status <> 'anonymised' and s.gps is not null
        and not exists (select 1 from flags f where f.supporter_id = s.id and f.type = 'gps_cluster')
      on conflict do nothing
      returning pu_code`)

    if (touched.size) await refreshFlaggedOpen(tx, [...touched])
    return result
  })
}

/** pu_stats.flagged_open = the open flags on each PU (5.4's resolve calls this too). */
export async function refreshFlaggedOpen(db: DbLike, puCodes: readonly string[]): Promise<void> {
  if (!puCodes.length) return
  await db.execute(sql`
    insert into pu_stats (pu_code, flagged_open)
    select u.code, (select count(*)::int from flags f where f.pu_code = u.code and f.status = 'open')
    from units u where u.code in ${puCodes}
    on conflict (pu_code) do update set flagged_open = excluded.flagged_open, updated_at = now()`)
}

/**
 * After a sync or an edit: run the checks for these supporters without ever failing the save (flags, not blocks).
 * Logs ids-free counts only.
 */
export async function flagAfterWrite(db: Db, supporterIds: readonly string[], gpsFlagMeters?: number): Promise<void> {
  if (!supporterIds.length) return
  try {
    await runFlagChecks(db, { supporterIds, gpsFlagMeters })
  }
  catch (error) {
    console.error('[flags] checks after a write failed; the nightly scan will catch up:', error instanceof Error ? error.message : error)
  }
}
