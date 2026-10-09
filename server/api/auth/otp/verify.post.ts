// POST /api/auth/otp/verify { phone, code, deviceId } → binds the device, starts the session (API.md)
import { createError, defineEventHandler } from 'h3'
import { verifyDeviceOtp } from '~~/server/services/auth'
import { otpVerifySchema } from '~~/shared/schemas/auth'
import { startSession } from '~~/server/utils/auth'
import { useAuthConfig } from '~~/server/utils/auth-config'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, clientIp, enforceRateLimit } from '~~/server/utils/rate-limit'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const input = await readValidated(event, otpVerifySchema)
  await enforceRateLimit(event, `otp-verify-ip:${clientIp(event)}`, RATE_LIMITS.otpVerifyIp)
  await enforceRateLimit(event, `otp-verify:${input.phone}`, RATE_LIMITS.otpVerify)
  const result = await verifyDeviceOtp(useDb(), input, useAuthConfig())
  if (result.kind === 'ok') {
    await startSession(event, result.user, input.deviceId)
    return { ok: true }
  }
  const reason = result.kind === 'invalid' ? 'code_invalid' : result.kind === 'expired' ? 'code_expired' : 'code_attempts'
  throw createError({ statusCode: 401, statusMessage: 'Unauthorized', data: { reason } })
})
