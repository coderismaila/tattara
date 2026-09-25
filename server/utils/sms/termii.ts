// Termii provider (ADR-007). Docs: https://developers.termii.com/messaging-api
// The base URL is account-specific (Termii dashboard) → NUXT_SMS_BASE_URL.
import { SmsSendError, isGsm7, type SmsProvider } from './types.ts'

export interface TermiiOptions {
  apiKey: string
  senderId: string
  baseUrl: string
  fetch?: typeof fetch
  timeoutMs?: number
}

interface TermiiResponse {
  code?: string
  message?: string
  message_id?: string
  message_id_str?: string
}

export function createTermiiProvider(options: TermiiOptions): SmsProvider {
  const { apiKey, senderId, baseUrl, timeoutMs = 15_000 } = options
  if (!apiKey || !senderId || !baseUrl) {
    throw new Error('Termii needs NUXT_SMS_API_KEY, NUXT_SMS_SENDER_ID and NUXT_SMS_BASE_URL.')
  }
  const doFetch = options.fetch ?? fetch
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/sms/send`

  return {
    name: 'termii',
    async send({ to, body, purpose }) {
      const payload = {
        api_key: apiKey,
        to: to.replace(/^\+/, ''), // Termii wants international format without "+"
        from: senderId,
        sms: body,
        // Hausa hooked letters are outside GSM-7; without unicode they arrive garbled.
        type: isGsm7(body) ? 'plain' : 'unicode',
        // "dnd" routes transactional traffic (OTPs, invites, receipts) past DND lists; broadcasts are promotional.
        channel: purpose === 'broadcast' ? 'generic' : 'dnd',
      }

      let res: Response
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        })
      }
      catch (error) {
        throw new SmsSendError(`Termii request failed: ${String(error)}`, true, { cause: error })
      }

      const data = await res.json().catch(() => ({})) as TermiiResponse
      if (!res.ok) {
        // 429 and 5xx are transient; other 4xx (bad number, sender ID, auth) will not succeed on retry.
        const retryable = res.status === 429 || res.status >= 500
        throw new SmsSendError(`Termii HTTP ${res.status}: ${data.message ?? 'no message'}`, retryable)
      }
      if (data.code && data.code !== 'ok') {
        throw new SmsSendError(`Termii rejected the message: ${data.message ?? data.code}`, false)
      }
      return { providerRef: data.message_id_str ?? data.message_id ?? null }
    },
  }
}
