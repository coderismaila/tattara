// Postgres enums derive from shared/constants (the single source of truth, DATA_MODEL §7).
import { pgEnum } from 'drizzle-orm/pg-core'
import {
  AGE_BANDS,
  CONSENT_LANGUAGES,
  FLAG_STATUSES,
  FLAG_TYPES,
  GENDERS,
  HAS_PVC,
  OTP_PURPOSES,
  SMS_PURPOSES,
  SMS_STATUSES,
  SUPPORTER_STATUSES,
  SUPPORT_LEVELS,
  UNIT_LEVELS,
  USER_STATUSES,
  VERIFICATION_STATUSES,
} from '../../../shared/constants/enums.ts'
import { ROLES } from '../../../shared/constants/roles.ts'

export const unitLevel = pgEnum('unit_level', UNIT_LEVELS)
export const userRole = pgEnum('user_role', ROLES)
export const userStatus = pgEnum('user_status', USER_STATUSES)
export const otpPurpose = pgEnum('otp_purpose', OTP_PURPOSES)
export const smsPurpose = pgEnum('sms_purpose', SMS_PURPOSES)
export const smsStatus = pgEnum('sms_status', SMS_STATUSES)
export const gender = pgEnum('gender', GENDERS)
export const ageBand = pgEnum('age_band', AGE_BANDS)
export const supportLevel = pgEnum('support_level', SUPPORT_LEVELS)
export const hasPvc = pgEnum('has_pvc', HAS_PVC)
export const consentLanguage = pgEnum('consent_language', CONSENT_LANGUAGES)
export const verificationStatus = pgEnum('verification_status', VERIFICATION_STATUSES)
export const supporterStatus = pgEnum('supporter_status', SUPPORTER_STATUSES)
export const flagType = pgEnum('flag_type', FLAG_TYPES)
export const flagStatus = pgEnum('flag_status', FLAG_STATUSES)
