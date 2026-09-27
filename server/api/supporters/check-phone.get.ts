// GET /api/supporters/check-phone?phone= → { countInSystem, samePu, limitReached } (API.md, US-7). PU leads only.
// Counts only: no names, PUs or ids. Rate-limited, since it tells whether a number is already known.
import { createError, defineEventHandler } from 'h3'
import { checkPhone } from '~~/server/services/supporters'
import { checkPhoneQuerySchema } from '~~/shared/schemas/supporter'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, enforceRateLimit } from '~~/server/utils/rate-limit'
import { readValidatedQuery } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  if (user.role !== 'PU_LEAD') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  await enforceRateLimit(event, `check-phone:${user.id}`, RATE_LIMITS.checkPhone)
  const { phone } = readValidatedQuery(event, checkPhoneQuerySchema)
  return (await checkPhone(useDb(), user, phone))!
})
