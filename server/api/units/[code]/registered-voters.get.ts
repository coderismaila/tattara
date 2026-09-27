// GET /api/units/:code/registered-voters → the PU figure, or the sum + "reported for X of Y PUs" above (US-24).
// `:code` is the unit code with dashes (`19-01-01`), or `all` for the region (DG/admin). Aggregates: admin allowed.
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { registeredVotersSummary } from '~~/server/services/units'
import { fromUrlCode } from '~~/shared/utils/pu-code'
import { useDb } from '~~/server/utils/db'
import { getScope, requireScope } from '~~/server/utils/scope'

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })

export default defineEventHandler(async (event) => {
  const code = fromUrlCode(getRouterParam(event, 'code'))
  if (code === null) {
    await getScope(event) // 401 before 404 when signed out
    throw notFound()
  }
  if (code === '') {
    const scope = await getScope(event)
    if (scope.unitCode !== '') throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  else {
    await requireScope(event, code, { allowAdmin: true })
  }
  const summary = await registeredVotersSummary(useDb(), code)
  if (!summary) throw notFound()
  return summary
})
