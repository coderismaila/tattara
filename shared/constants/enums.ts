// Single source of truth for every enum (DATA_MODEL §7).
// Zod schemas, Drizzle pgEnums and i18n label keys derive from these arrays; never duplicate them.

export const UNIT_LEVELS = ['state', 'lga', 'ward', 'pu'] as const
export type UnitLevel = typeof UNIT_LEVELS[number]

export const USER_STATUSES = ['invited', 'active', 'locked', 'deactivated'] as const
export type UserStatus = typeof USER_STATUSES[number]

export const OTP_PURPOSES = ['device', 'reset'] as const
export type OtpPurpose = typeof OTP_PURPOSES[number]

export const GENDERS = ['male', 'female'] as const
export type Gender = typeof GENDERS[number]

export const AGE_BANDS = ['18_24', '25_34', '35_44', '45_54', '55_64', '65_plus'] as const
export type AgeBand = typeof AGE_BANDS[number]

export const SUPPORT_LEVELS = ['strong', 'leaning', 'undecided'] as const
export type SupportLevel = typeof SUPPORT_LEVELS[number]

/** Whether the supporter holds a PVC. Never store the PVC/VIN number itself. */
export const HAS_PVC = ['yes', 'no', 'unsure'] as const
export type HasPvc = typeof HAS_PVC[number]

export const CONSENT_LANGUAGES = ['ha', 'en'] as const
export type ConsentLanguage = typeof CONSENT_LANGUAGES[number]

export const VERIFICATION_STATUSES = [
  'unverified',
  'sms_delivered',
  'callback_verified',
  'callback_failed',
  'opted_out',
] as const
export type VerificationStatus = typeof VERIFICATION_STATUSES[number]

export const SUPPORTER_STATUSES = ['active', 'removal_requested', 'anonymised'] as const
export type SupporterStatus = typeof SUPPORTER_STATUSES[number]

export const FLAG_TYPES = [
  'gps_far',
  'duplicate_phone',
  'pu_over_capacity',
  'rate_anomaly',
  'gps_cluster',
  'callback_failed',
  'opt_out_spike',
] as const
export type FlagType = typeof FLAG_TYPES[number]

export const FLAG_STATUSES = ['open', 'dismissed', 'confirmed'] as const
export type FlagStatus = typeof FLAG_STATUSES[number]

export const CALLBACK_OUTCOMES = ['verified', 'wrong_number', 'denies', 'unreachable'] as const
export type CallbackOutcome = typeof CALLBACK_OUTCOMES[number]

export const SMS_PURPOSES = ['thank_you', 'otp', 'invite', 'broadcast'] as const
export type SmsPurpose = typeof SMS_PURPOSES[number]

export const SMS_STATUSES = ['queued', 'sent', 'failed', 'delivered'] as const
export type SmsStatus = typeof SMS_STATUSES[number]
