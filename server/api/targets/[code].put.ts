// PUT /api/targets/:code { target } → { code, target, previous } (API.md, task 6.4). The DG for a state, otherwise the
// lead of the unit directly above :code. Audited. Out of scope 403 (like the stats routes), other callers 403.
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { setTarget } from '~~/server/services/targets'
import { targetSchema } from '~~/shared/schemas/targets'
import { fromUrlCode } from '~~/shared/utils/pu-code'
import { useDb } from '~~/server/utils/db'
import { requireAuth } from '~~/server/utils/auth'
import { requireScope } from '~~/server/utils/scope'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const code = fromUrlCode(getRouterParam(event, 'code'))
  // The region (`all`) has no target.
  if (!code) throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
  await requireScope(event, code)
  const { target } = await readValidated(event, targetSchema)

  const outcome = await setTarget(useDb(), user, code, target)
  switch (outcome.kind) {
    case 'ok':
      return outcome.result
    case 'forbidden':
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
    case 'not_found':
      throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
    case 'invalid':
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid' } })
  }
})
