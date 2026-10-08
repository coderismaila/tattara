// /api/stats/children query (API.md, task 6.1). Error messages are i18n keys.
import { z } from 'zod'
import { CHILD_METRICS } from '../types/stats.ts'

export const childrenStatsQuerySchema = z.object({
  /** Default: coverage, lowest first (where to act, UX §4.2). */
  metric: z.enum(CHILD_METRICS, 'stats.errors.invalid').default('coverage'),
  sort: z.enum(['asc', 'desc'], 'stats.errors.invalid').default('asc'),
})

export type ChildrenStatsQuery = z.output<typeof childrenStatsQuerySchema>
