// POST /api/auth/login { phone, pin, deviceId } → 200 session | 202 { otpRequired } (API.md)
import { createError, defineEventHandler, setResponseStatus } from 'h3'
import { attemptLogin } from '~~/server/services/auth'
import { loginSchema } from '~~/shared/schemas/auth'
import { startSession } from '~~/server/utils/auth'
import { sendQueuedSmsNow, useAuthConfig } from '~~/server/utils/auth-config'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, enforceRateLimit, tooManyRequests } from '~~/server/utils/rate-limit'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const input = await readValidated(event, loginSchema)
  await enforceRateLimit(event, `login:${input.phone}`, RATE_LIMITS.login)

  const result = await attemptLogin(useDb(), input, useAuthConfig(), sendQueuedSmsNow)
  switch (result.kind) {
    case 'ok':
      await startSession(event, result.user, input.deviceId)
      return { ok: true }
    case 'otp_required':
      setResponseStatus(event, 202)
      return { otpRequired: true }
    case 'invalid':
      // Same answer for an unknown phone and a wrong PIN.
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized', data: { reason: 'invalid_credentials' } })
    case 'locked':
      throw createError({ statusCode: 423, statusMessage: 'Locked', data: { reason: 'locked', retryAfterSec: result.retryAfterSec } })
    case 'otp_rate_limited':
      throw tooManyRequests(event, result.retryAfterSec)
  }
})
