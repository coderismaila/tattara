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

/** Supporter messages (5.2): one language (the one consent was given in), no supporter name. */
export interface SupporterSmsOptions {
  /** Organisation the supporter backed (NUXT_PUBLIC_ORG_NAME); blank → "Tattara". */
  orgName: string
  /** Two-way number that receives STOP (NUXT_SMS_REPLY_NUMBER); blank → "tell your PU lead". */
  replyNumber: string
}

const org = (o: SupporterSmsOptions) => o.orgName.trim() || 'Tattara'

export const SUPPORTER_SMS_TEXT = {
  thankYou: {
    // TODO(ha-review)
    ha: (o: SupporterSmsOptions) => o.replyNumber
      ? `${org(o)}: mun gode da goyon bayanku. Don a cire sunanku, aika STOP zuwa ${o.replyNumber}.`
      : `${org(o)}: mun gode da goyon bayanku. Don a cire sunanku, ku fada wa shugaban rumfarku.`,
    en: (o: SupporterSmsOptions) => o.replyNumber
      ? `${org(o)}: thank you for your support. To be removed, reply STOP to ${o.replyNumber}.`
      : `${org(o)}: thank you for your support. To be removed, tell your polling unit lead.`,
  },
  optOutConfirm: {
    // TODO(ha-review)
    ha: (o: SupporterSmsOptions) => `${org(o)}: an cire sunanku. Ba za ku sake samun sako daga gare mu ba.`,
    en: (o: SupporterSmsOptions) => `${org(o)}: you have been removed. You will get no more messages from us.`,
  },
} as const
