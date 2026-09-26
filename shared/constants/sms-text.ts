// Transactional SMS texts (OTP, invite, alerts). Hausa first, written WITHOUT hooked letters (k for ƙ, d for ɗ, b for
// ɓ, y for ƴ) so every message stays in the GSM-7 alphabet: a hooked letter switches the whole SMS to unicode, which
// cuts a segment from 160 to 70 characters and roughly doubles the cost (ADR-024). Keep each text under 160 chars.
// Broadcast templates (US-16) live in the sms_templates table instead.

export const SMS_TEXT = {
  // TODO(ha-review)
  otp: (code: string) => `Tattara: lambar tabbatarwa ${code}. Ta kare cikin minti 10. Kada ku ba kowa. / Your code: ${code}`,
  // TODO(ha-review)
  invite: (url: string) => `Tattara: an gayyace ku. Bude ku zabi PIN: ${url} (kwana 3) / You're invited, set your PIN`,
  // TODO(ha-review)
  lockoutAlert: (unitCode: string) => `Tattara: an kulle asusun ${unitCode} sau 3 cikin awa 24. / Account ${unitCode} locked 3 times in 24h.`,
} as const
