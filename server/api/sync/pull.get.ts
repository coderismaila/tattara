// GET /api/sync/pull?since=&cursor= → { supporters, units, stats, announcements, serverTime, nextCursor } (API.md,
// ARCHITECTURE §5). PU and ward leads only: their own unit's supporters, in full (they may see them, SECURITY_PRIVACY §3).
import { createError, defineEventHandler } from 'h3'
import { pullForCaller } from '~~/server/services/sync'
import { syncPullQuerySchema } from '~~/shared/schemas/sync'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, enforceRateLimit } from '~~/server/utils/rate-limit'
import { readValidatedQuery } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  if (user.role !== 'PU_LEAD' && user.role !== 'WARD_LEAD') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  }
  await enforceRateLimit(event, `sync-pull:${user.id}`, RATE_LIMITS.syncPull)
  const query = readValidatedQuery(event, syncPullQuerySchema)
  const result = await pullForCaller(useDb(), user, query)
  if (result.kind === 'forbidden') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  return result.body
})
