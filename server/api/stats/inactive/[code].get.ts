// GET /api/stats/inactive/:code?days=3 → active PU leads with no captures in N days, and leads invited but never set up
// (API.md, task 6.5). Names leads (no phone numbers), so ward leads and above and the DG only: not the admin, not PU
// leads. Cached 60 s per unit and window.
import { createError, defineEventHandler } from 'h3'
import { defineCachedFunction } from 'nitropack/runtime'
import { inactiveLeads } from '~~/server/services/activity'
import { inactiveQuerySchema } from '~~/shared/schemas/stats'
import { useDb } from '~~/server/utils/db'
import { getScope } from '~~/server/utils/scope'
import { statsCode } from '~~/server/utils/stats-http'
import { readValidatedQuery } from '~~/server/utils/validate'

const cachedInactive = defineCachedFunction(
  (code: string, days: number) => inactiveLeads(useDb(), code, days),
  { name: 'stats-inactive', maxAge: 60, getKey: (code: string, days: number) => `${code || 'all'}:${days}` },
)

export default defineEventHandler(async (event) => {
  const code = await statsCode(event, { allowAdmin: false })
  if ((await getScope(event)).role === 'PU_LEAD') throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  const { days } = readValidatedQuery(event, inactiveQuerySchema)
  const list = await cachedInactive(code, days)
  if (!list) throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
  return list
})
