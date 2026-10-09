// /api/stats/children query (API.md, task 6.1). Error messages are i18n keys.
import { z } from 'zod'
import { UNIT_LEVELS } from '../constants/enums.ts'
import { CHILD_METRICS, LEADERBOARD_METRICS } from '../types/stats.ts'

export const childrenStatsQuerySchema = z.object({
  /** Default: coverage, lowest first (where to act, UX §4.2). */
  metric: z.enum(CHILD_METRICS, 'stats.errors.invalid').default('coverage'),
  sort: z.enum(['asc', 'desc'], 'stats.errors.invalid').default('asc'),
})

export type ChildrenStatsQuery = z.output<typeof childrenStatsQuerySchema>

/** /api/stats/leaderboard (task 6.5). `level` defaults to one below the unit; it must be below it (checked by the service). */
export const leaderboardQuerySchema = z.object({
  level: z.enum(UNIT_LEVELS, 'stats.errors.invalid').optional(),
  metric: z.enum(LEADERBOARD_METRICS, 'stats.errors.invalid').default('recent'),
  limit: z.coerce.number('stats.errors.invalid').int('stats.errors.invalid').min(1, 'stats.errors.invalid').max(100, 'stats.errors.invalid').default(20),
})

/** /api/stats/inactive (task 6.5): no captures in `days` days. */
export const inactiveQuerySchema = z.object({
  days: z.coerce.number('stats.errors.invalid').int('stats.errors.invalid').min(1, 'stats.errors.invalid').max(30, 'stats.errors.invalid').default(3),
})

export type LeaderboardQuery = z.output<typeof leaderboardQuerySchema>
export type InactiveQuery = z.output<typeof inactiveQuerySchema>
