// SMS provider selection from runtime config (NUXT_SMS_*). Providers themselves are runtime-agnostic.
import { useRuntimeConfig } from 'nitropack/runtime'
import { createFakeSmsProvider } from './fake.ts'
import { createTermiiProvider } from './termii.ts'
import type { SmsProvider } from './types.ts'

export * from './types.ts'

let provider: SmsProvider | undefined

export function getSmsProvider(): SmsProvider {
  if (provider) return provider
  const { sms } = useRuntimeConfig()
  switch (sms.provider) {
    case 'termii':
      provider = createTermiiProvider({ apiKey: sms.apiKey, senderId: sms.senderId, baseUrl: sms.baseUrl })
      break
    case 'fake':
      provider = createFakeSmsProvider()
      break
    default:
      throw new Error(`Unknown SMS provider "${String(sms.provider)}" (NUXT_SMS_PROVIDER: fake | termii)`)
  }
  return provider
}
