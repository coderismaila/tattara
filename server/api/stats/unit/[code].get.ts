// GET /api/stats/unit/:code → totals, coverage, target, breakdowns, last 30 days (API.md, task 6.1). Aggregates only.
// Cached for 60 s per unit (the same numbers for everyone allowed to see them).
import { createError, defineEventHandler } from 'h3'
import { defineCachedFunction } from 'nitropack/runtime'
import { unitStats } from '~~/server/services/stats'
import { useDb } from '~~/server/utils/db'
import { statsCode } from '~~/server/utils/stats-http'

const cachedUnitStats = defineCachedFunction((code: string) => unitStats(useDb(), code), {
  name: 'stats-unit',
  maxAge: 60,
  getKey: (code: string) => code || 'all',
})

export default defineEventHandler(async (event) => {
  const code = await statsCode(event)
  const stats = await cachedUnitStats(code)
  if (!stats) throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
  return stats
})
