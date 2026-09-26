// Dev/test provider: "sends" to the console. The sms_queue row is the durable record.
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { maskPhone, type SmsProvider } from './types.ts'

export interface FakeSmsOptions {
  nodeEnv?: string
  /** Where lines go (defaults to console.info); tests pass a collector. */
  log?: (line: string) => void
  /**
   * Also append each message as a JSON line to this file (NUXT_SMS_FAKE_OUTBOX). E2E tests read OTP and invite
   * codes from it. Never in production: the fake provider refuses to start there.
   */
  outboxFile?: string
}

export function createFakeSmsProvider(options: FakeSmsOptions = {}): SmsProvider {
  // The body can contain OTP codes: never let them reach production logs.
  if ((options.nodeEnv ?? process.env.NODE_ENV) === 'production') {
    throw new Error('The fake SMS provider cannot be used in production. Set NUXT_SMS_PROVIDER=termii.')
  }
  const log = options.log ?? ((line: string) => console.info(line))
  return {
    name: 'fake',
    async send({ to, body, purpose }) {
      const providerRef = `fake-${randomUUID()}`
      log(`[sms:fake] ${purpose} → ${maskPhone(to)}: ${body}`)
      if (options.outboxFile) {
        appendFileSync(options.outboxFile, `${JSON.stringify({ to, body, purpose, providerRef, at: new Date().toISOString() })}\n`)
      }
      return { providerRef }
    },
  }
}
