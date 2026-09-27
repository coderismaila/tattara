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

let running: Promise<unknown> | null = null
let rerun = false

/**
 * Send queued SMS now rather than on the next minute tick (OTPs must arrive in seconds). Fire-and-forget.
 * Nitro's runTask joins a run already in progress, which would miss a message queued during that run (two leads
 * signing in at once): so if a run is in flight, run once more when it ends.
 */
export function sendQueuedSmsNow(): void {
  if (running) {
    rerun = true
    return
  }
  running = runTask('sms:process')
    .catch((error: unknown) => {
      console.error('[sms] immediate send failed; the scheduled task will retry:', error instanceof Error ? error.message : error)
    })
    .finally(() => {
      running = null
      if (rerun) {
        rerun = false
        sendQueuedSmsNow()
      }
    })
}
