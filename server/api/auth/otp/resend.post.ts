// POST /api/auth/otp/resend { phone } → 202 (always, unless rate-limited, so it reveals nothing) (API.md)
import { defineEventHandler, setResponseStatus } from 'h3'
import { resendDeviceOtp } from '~~/server/services/auth'
import { otpResendSchema } from '~~/shared/schemas/auth'
import { sendQueuedSmsNow, useAuthConfig } from '~~/server/utils/auth-config'
import { useDb } from '~~/server/utils/db'
import { tooManyRequests } from '~~/server/utils/rate-limit'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { phone } = await readValidated(event, otpResendSchema)
  const result = await resendDeviceOtp(useDb(), phone, useAuthConfig(), sendQueuedSmsNow)
  if (result.kind === 'rate_limited') throw tooManyRequests(event, result.retryAfterSec)
  setResponseStatus(event, 202)
  return { ok: true }
})
