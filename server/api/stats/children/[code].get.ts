// GET /api/stats/children/:code?metric=&sort= → one row per child unit (API.md, task 6.1): drives the ranked table and
// the choropleth. Default: coverage, lowest first. Aggregates only; cached for 60 s per unit, metric and order.
import { createError, defineEventHandler } from 'h3'
import { defineCachedFunction } from 'nitropack/runtime'
import { childrenStats } from '~~/server/services/stats'
import { childrenStatsQuerySchema } from '~~/shared/schemas/stats'
import type { ChildMetric } from '~~/shared/types/stats'
import { useDb } from '~~/server/utils/db'
import { statsCode } from '~~/server/utils/stats-http'
import { readValidatedQuery } from '~~/server/utils/validate'

const cachedChildren = defineCachedFunction(
  (code: string, metric: ChildMetric, sort: 'asc' | 'desc') => childrenStats(useDb(), code, metric, sort),
  { name: 'stats-children', maxAge: 60, getKey: (code: string, metric: string, sort: string) => `${code || 'all'}:${metric}:${sort}` },
)

export default defineEventHandler(async (event) => {
  const code = await statsCode(event)
  const { metric, sort } = readValidatedQuery(event, childrenStatsQuerySchema)
  const stats = await cachedChildren(code, metric, sort)
  if (!stats) throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
  return stats
})
