// Phone normalisation to E.164 (+234…). Supporters and leads need a Nigerian mobile (SMS verification).
// Uses the small "min" metadata to keep the capture route light; the mobile check is a prefix rule below.
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'

// Nigerian mobile national numbers: 10 digits starting 70x, 80x, 81x, 90x, 91x.
const NG_MOBILE_NATIONAL = /^[789][01]\d{8}$/

/**
 * Normalise a Nigerian mobile number to E.164, e.g. `0803 123 4567` → `+2348031234567`.
 * Accepts `0803…`, `803…`, `+234803…`, `234803…` with spaces, dashes, dots or brackets.
 * Returns `null` for anything that isn't a valid Nigerian mobile number.
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!/^\+?[\d\s\-.()]+$/.test(trimmed)) return null

  const digits = trimmed.replace(/\D/g, '')
  const hasPlus = trimmed.startsWith('+')

  let candidate: string
  if (hasPlus) candidate = `+${digits}`
  else if (digits.startsWith('234') && digits.length === 13) candidate = `+${digits}`
  else if (digits.length === 10 && !digits.startsWith('0')) candidate = `0${digits}`
  else candidate = digits

  const parsed = parsePhoneNumberFromString(candidate, 'NG')
  if (!parsed || parsed.country !== 'NG' || !parsed.isValid()) return null
  if (!NG_MOBILE_NATIONAL.test(parsed.nationalNumber)) return null
  return parsed.number
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null
}
