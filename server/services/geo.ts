// PU points for the map (task 6.3, ARCHITECTURE §8): one ward's polling units with their location and numbers.
// Aggregates and unit locations only. Pure (DB injected).
import { sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.ts'
import type { PuPoint } from '../../shared/types/geo.ts'
import { coverageOf } from './stats.ts'

/** Active PUs of `wardCode` that have a location, in code order. */
export async function puPoints(db: DbLike, wardCode: string): Promise<PuPoint[]> {
  const rows = await db.execute<{ code: string, name: string, lat: number, lng: number, estimated: boolean, total: number, voters: number | null }>(sql`
    select u.code, u.name, ST_Y(u.location::geometry) as lat, ST_X(u.location::geometry) as lng,
      u.location_estimated as estimated, coalesce(p.total, 0)::int as total, u.registered_voters as voters
    from units u left join pu_stats p on p.pu_code = u.code
    where u.level = 'pu' and u.active and u.parent_code = ${wardCode} and u.location is not null
    order by u.code`)
  return (rows as unknown as { code: string, name: string, lat: number, lng: number, estimated: boolean, total: number, voters: number | null }[])
    .map(r => ({
      code: r.code,
      name: r.name,
      lat: Number(r.lat),
      lng: Number(r.lng),
      locationEstimated: r.estimated,
      total: r.total,
      coverage: coverageOf(r.total, r.voters),
    }))
}
