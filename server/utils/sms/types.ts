// SMS provider contract (ARCHITECTURE §9). Runtime-agnostic: no Nitro imports.
import type { SmsPurpose } from '../../../shared/constants/enums.ts'

export interface SmsMessage {
  /** E.164, e.g. +2348031234567 */
  to: string
  body: string
  purpose: SmsPurpose
}

export interface SmsSendResult {
  /** Provider message id, stored as sms_queue.provider_ref for delivery reports. */
  providerRef: string | null
}

export interface SmsProvider {
  readonly name: string
  send(message: SmsMessage): Promise<SmsSendResult>
}

/**
 * A failed send. `retryable` = worth trying again later (network, timeouts, 5xx, 429);
 * otherwise permanent (bad number, rejected sender ID, auth).
 */
export class SmsSendError extends Error {
  override name = 'SmsSendError'
  // A plain field, not a parameter property, so scripts can load this under Node's type stripping.
  readonly retryable: boolean
  constructor(message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options)
    this.retryable = retryable
  }
}

/** Mask a phone for logs (SECURITY §8): +2348031234567 → +234803****567. */
export function maskPhone(phone: string): string {
  return phone.length > 7 ? `${phone.slice(0, 7)}****${phone.slice(-3)}` : '****'
}

// GSM 03.38 default alphabet + extension table. Anything else forces UCS-2 ("unicode").
const GSM7 = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
  + '^{}\\[~]|€',
)

/** True if the text fits the GSM-7 alphabet. Hausa hooked letters (ɓ ɗ ƙ ƴ) do not. */
export function isGsm7(text: string): boolean {
  for (const ch of text) if (!GSM7.has(ch)) return false
  return true
}
