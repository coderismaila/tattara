// POST /api/sync/push { items: SupporterInput[≤50] } → { results } (API.md, ARCHITECTURE §5). PU leads only.
// Each item is validated and upserted on its own; results come back in the same order.
import { createError, defineEventHandler } from 'h3'
import { pushSupporters } from '~~/server/services/supporters'
import { syncPushSchema } from '~~/shared/schemas/supporter'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, enforceRateLimit } from '~~/server/utils/rate-limit'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  // Only PU leads capture (SECURITY_PRIVACY §3); createSupporter re-checks each item's PU against the caller's.
  if (user.role !== 'PU_LEAD') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  await enforceRateLimit(event, `sync-push:${user.id}`, RATE_LIMITS.syncPush)
  const { items } = await readValidated(event, syncPushSchema)
  return { results: await pushSupporters(useDb(), user, items) }
})
