// PUT /api/units/:code/registered-voters { registeredVoters } (US-24): the PU's own lead, or its ward lead. Audited.
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { setRegisteredVoters } from '~~/server/services/units'
import { registeredVotersSchema } from '~~/shared/schemas/units'
import { fromUrlCode } from '~~/shared/utils/pu-code'
import { useDb } from '~~/server/utils/db'
import { requireAuth } from '~~/server/utils/auth'
import { requireScope } from '~~/server/utils/scope'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const code = fromUrlCode(getRouterParam(event, 'code'))
  if (!code) throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
  await requireScope(event, code)
  const { registeredVoters } = await readValidated(event, registeredVotersSchema)

  const result = await setRegisteredVoters(useDb(), user, code, registeredVoters)
  switch (result.kind) {
    case 'ok':
      return result.summary
    case 'forbidden':
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
    case 'not_found':
      throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
    case 'invalid':
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid' } })
  }
})
