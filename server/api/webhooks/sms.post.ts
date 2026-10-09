// POST /api/webhooks/sms (API.md, task 5.2): the SMS provider's delivery reports and inbound replies. No session: the
// HMAC-SHA512 signature of the raw body (NUXT_SMS_WEBHOOK_SECRET) is the authentication; the origin check exempts
// /api/webhooks. Unknown events are acknowledged and ignored, so the provider doesn't retry them forever.
import { createError, defineEventHandler, getRequestHeader, readRawBody } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { applyDeliveryReport, handleStop } from '~~/server/services/supporter-sms'
import { sendQueuedSmsNow } from '~~/server/utils/auth-config'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, clientIp, enforceRateLimit } from '~~/server/utils/rate-limit'
import { SMS_SIGNATURE_HEADER, isStopMessage, parseSmsWebhook, verifySmsSignature } from '~~/server/utils/sms/webhook'
import { useSupporterSmsConfig } from '~~/server/utils/supporter-sms-config'

export default defineEventHandler(async (event) => {
  const secret = String(useRuntimeConfig().sms.webhookSecret ?? '')
  // Off until a secret is configured: never accept unsigned events.
  if (!secret) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  await enforceRateLimit(event, `sms-webhook:${clientIp(event)}`, RATE_LIMITS.smsWebhook)

  const raw = (await readRawBody(event, 'utf8')) ?? ''
  if (!verifySmsSignature(raw, getRequestHeader(event, SMS_SIGNATURE_HEADER), secret)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', data: { reason: 'bad_signature' } })
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid' } })
  }

  const db = useDb()
  const parsed = parseSmsWebhook(payload)
  switch (parsed.kind) {
    case 'delivery':
      return { ok: true, handled: await applyDeliveryReport(db, parsed.providerRef, parsed.status) ? 'delivery' : 'unknown_message' }
    case 'inbound': {
      if (!isStopMessage(parsed.text)) return { ok: true, handled: 'inbound_ignored' }
      const result = await handleStop(db, parsed.from, useSupporterSmsConfig())
      if (result.confirmationQueued) sendQueuedSmsNow()
      return { ok: true, handled: 'stop' }
    }
    default:
      return { ok: true, handled: 'ignored' }
  }
})
