// What the PU lead's home shows when there is no connection (task 6.2): today's captures from the phone's records, and
// the last unit numbers fetched online (aggregates only), kept in `meta` so sign-out wipes them with everything else.
import { lagosDate } from '~~/shared/utils/lagos-date'
import { db, getMeta, setMeta } from './db'

export interface HomeStatsSnapshot {
  supporters: number
  verified: number
  target: number | null
  /** When the server computed them (ISO). */
  computedAt: string
}

const KEY = 'homeStats'

export const getHomeStats = () => getMeta<HomeStatsSnapshot>(KEY)
export const saveHomeStats = (s: HomeStatsSnapshot) => setMeta(KEY, s)

/** The start of today in Lagos (WAT, UTC+1), as an ISO instant. */
export function lagosDayStart(now = new Date()): string {
  return new Date(`${lagosDate(now)}T00:00:00+01:00`).toISOString()
}

/** Supporters on `puCode` captured today (Lagos), on this phone: its own and pulled ones; refused captures don't count. */
export async function countCapturedToday(puCode: string, now = new Date()): Promise<number> {
  const since = lagosDayStart(now)
  return db.supporters.where('capturedAt').aboveOrEqual(since)
    .filter(s => s.puCode === puCode && s.syncStatus !== 'rejected')
    .count()
}
