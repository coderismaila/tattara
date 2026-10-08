// POST /api/sync/push { items: SupporterInput[≤50] } → { results } (API.md, ARCHITECTURE §5). PU leads only.
// Each item is validated and upserted on its own; results come back in the same order. New records then go through
// the flag checks (5.1) and get a thank-you SMS (5.2).
import { createError, defineEventHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { flagAfterWrite } from '~~/server/services/flags'
import { queueThankYous } from '~~/server/services/supporter-sms'
import { pushSupporters } from '~~/server/services/supporters'
import { syncPushSchema } from '~~/shared/schemas/supporter'
import { requireAuth } from '~~/server/utils/auth'
import { afterResponse } from '~~/server/utils/after-response'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, enforceRateLimit } from '~~/server/utils/rate-limit'
import { useSupporterSmsConfig } from '~~/server/utils/supporter-sms-config'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  // Only PU leads capture (SECURITY_PRIVACY §3); createSupporter re-checks each item's PU against the caller's.
  if (user.role !== 'PU_LEAD') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  await enforceRateLimit(event, `sync-push:${user.id}`, RATE_LIMITS.syncPush)
  const { items } = await readValidated(event, syncPushSchema)
  const results = await pushSupporters(useDb(), user, items)
  // Flag checks (5.1) and the thank-you SMS (5.2) for what was newly accepted, after answering: the lead's save shouldn't
  // wait for them (a slow 3G push is slow enough), and neither may fail the push.
  const accepted = results.flatMap(r => (r.result === 'accepted' ? [r.id] : []))
  if (accepted.length) {
    afterResponse('sync-push', async () => {
      await flagAfterWrite(useDb(), accepted, Number(useRuntimeConfig().public.gpsFlagMeters))
      await queueThankYous(useDb(), accepted, useSupporterSmsConfig())
    })
  }
  return { results }
})
