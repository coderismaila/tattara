// Provider webhook (task 5.2, API.md `POST /webhooks/sms`): signature check and payload parsing. Pure and
// runtime-agnostic. Termii signs each event with HMAC-SHA512 of the raw body in `X-Termii-Signature`
// (https://developer.termii.com/events-and-reports). The inbound payload is not documented there: the parser accepts
// the field names Termii uses for outbound reports and must be checked against a real event before the pilot (👤).
import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizePhone } from '../../../shared/utils/phone.ts'

export const SMS_SIGNATURE_HEADER = 'x-termii-signature'

/** True when `signature` (hex) is the HMAC-SHA512 of the raw body with `secret`. Constant time. */
export function verifySmsSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^[0-9a-f]+$/i.test(signature.trim())) return false
  const expected = createHmac('sha512', secret).update(rawBody, 'utf8').digest()
  const given = Buffer.from(signature.trim(), 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export function signSmsWebhook(rawBody: string, secret: string): string {
  return createHmac('sha512', secret).update(rawBody, 'utf8').digest('hex')
}

export type SmsWebhookEvent
  = | { kind: 'delivery', providerRef: string, status: 'delivered' | 'failed' }
    | { kind: 'inbound', from: string, text: string }
    | { kind: 'ignored', why: string }

type Payload = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** Delivery states that end a message. Anything else ("Message Sent") is an intermediate state. */
function deliveryStatus(status: string): 'delivered' | 'failed' | null {
  const s = status.toLowerCase()
  if (s.includes('deliver')) return 'delivered'
  if (/fail|reject|expire|dnd|undeliver/.test(s)) return 'failed'
  return null
}

/** Turn a provider event into one of ours. Never throws on unknown shapes: they are ignored (and acknowledged). */
export function parseSmsWebhook(payload: unknown): SmsWebhookEvent {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { kind: 'ignored', why: 'not an object' }
  const p = payload as Payload
  const type = str(p.type).toLowerCase()
  const status = str(p.status)

  if (type.includes('inbound') || status.toLowerCase() === 'received') {
    const from = normalizePhone(str(p.sender) || str(p.from) || str(p.msisdn))
    const text = str(p.message) || str(p.sms) || str(p.text)
    if (!from) return { kind: 'ignored', why: 'inbound without a Nigerian mobile sender' }
    return { kind: 'inbound', from, text }
  }

  const providerRef = str(p.message_id) || str(p.id)
  const mapped = deliveryStatus(status)
  if (!providerRef) return { kind: 'ignored', why: 'no message id' }
  if (!mapped) return { kind: 'ignored', why: `status ${status || 'missing'}` }
  return { kind: 'delivery', providerRef, status: mapped }
}

/** Words that mean "remove me" (US-9, US-18): STOP and common variants, in English and Hausa. */
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'cire', 'daina', 'dakata'])

/** True when the reply asks to stop: its first word (letters only) is a stop word. */
export function isStopMessage(text: string): boolean {
  const compact = text.trim().toLowerCase().replace(/[^a-z\s]/g, '')
  const [first = '', second = ''] = compact.split(/\s+/)
  return STOP_WORDS.has(first) || STOP_WORDS.has(first + second)
}
