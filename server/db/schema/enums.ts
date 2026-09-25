// Postgres enums derive from shared/constants (the single source of truth, DATA_MODEL §7).
import { pgEnum } from 'drizzle-orm/pg-core'
import { OTP_PURPOSES, UNIT_LEVELS, USER_STATUSES } from '../../../shared/constants/enums.ts'
import { ROLES } from '../../../shared/constants/roles.ts'

export const unitLevel = pgEnum('unit_level', UNIT_LEVELS)
export const userRole = pgEnum('user_role', ROLES)
export const userStatus = pgEnum('user_status', USER_STATUSES)
export const otpPurpose = pgEnum('otp_purpose', OTP_PURPOSES)
