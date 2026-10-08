// Supporter SMS settings from runtime config (task 5.2), validated once.
import { useRuntimeConfig } from 'nitropack/runtime'
import type { SupporterSmsConfig } from '../services/supporter-sms.ts'

let cached: SupporterSmsConfig | undefined

/** Throws when NUXT_PHONE_HASH_SECRET is missing: opt-outs can't be stored or checked without it. */
export function useSupporterSmsConfig(): SupporterSmsConfig {
  if (cached) return cached
  const config = useRuntimeConfig()
  const phoneHashSecret = String(config.phoneHashSecret ?? '')
  if (phoneHashSecret.length < 32) {
    throw new Error('NUXT_PHONE_HASH_SECRET must be set (at least 32 characters). See .env.example.')
  }
  cached = {
    phoneHashSecret,
    orgName: String(config.public.orgName ?? ''),
    replyNumber: String(config.sms.replyNumber ?? ''),
  }
  return cached
}
