// GET /api/sync/pull (API.md, task 4.3): what a PU or ward lead's phone keeps current offline.
import type { UnitLevel } from '../constants/enums'
import type { SupporterDto } from './supporter'

/** An anonymised supporter: the phone removes its copy. */
export interface SupporterTombstone {
  id: string
  deleted: true
}

export interface PullUnit {
  code: string
  parentCode: string | null
  name: string
  level: UnitLevel
  active: boolean
}

/** Totals over the lead's unit (sums of pu_stats). No names or phones. */
export interface PullStats {
  total: number
  verified: number
  flaggedOpen: number
  lastCaptureAt: string | null
}

export interface PullResponse {
  supporters: (SupporterDto | SupporterTombstone)[]
  /** The lead's unit and everything under it. First page only (`[]` on later pages). */
  units: PullUnit[]
  stats: PullStats
  /** v1.1 (messaging). Always empty for now. */
  announcements: never[]
  /** Pass as `since` on the next pull once every page is in (already includes the overlap). */
  serverTime: string
  /** Pass as `cursor` (with the same `since`) for the next page; NULL on the last page. */
  nextCursor: string | null
}
