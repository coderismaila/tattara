// Auth settings from runtime config, validated once.
import { runTask, useRuntimeConfig } from 'nitropack/runtime'
import type { AuthConfig } from '../services/auth.ts'

let cached: AuthConfig | undefined

export function useAuthConfig(): AuthConfig {
  if (cached) return cached
  const config = useRuntimeConfig()
  const otpSecret = String(config.otpSecret ?? '')
  if (otpSecret.length < 32) {
    throw new Error('NUXT_OTP_SECRET must be set (at least 32 characters). See .env.example.')
  }
  cached = { otpSecret, siteUrl: String(config.public.siteUrl) }
  return cached
}

/** Send queued SMS now rather than on the next minute tick (OTPs must arrive in seconds). Fire-and-forget. */
export function sendQueuedSmsNow(): void {
  runTask('sms:process').catch((error: unknown) => {
    console.error('[sms] immediate send failed; the scheduled task will retry:', error instanceof Error ? error.message : error)
  })
}
