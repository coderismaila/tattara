// People (DATA_MODEL §2): team leads and admins, their devices, invites and OTPs.
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { newId } from '../../../shared/utils/uuid.ts'
import { otpPurpose, unitLevel, userRole, userStatus } from './enums.ts'
import { units } from './units.ts'

export const users = pgTable('users', {
  id: uuid().primaryKey().$defaultFn(newId),
  fullName: text().notNull(),
  /** E.164 Nigerian mobile, normalised with shared/utils/phone.ts. */
  phone: text().notNull().unique(),
  role: userRole().notNull(),
  /** NULL for ADMIN/DG. */
  unitCode: text(),
  /** Denormalised from units.level so the composite FK enforces role ↔ unit level. */
  unitLevel: unitLevel(),
  /** argon2id; NULL until invite setup. */
  pinHash: text(),
  status: userStatus().notNull().default('invited'),
  /** Bump to revoke all sessions. */
  sessionVersion: integer().notNull().default(0),
  failedPinAttempts: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
  invitedBy: uuid().references((): AnyPgColumn => users.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp({ withTimezone: true }),
}, t => [
  foreignKey({
    name: 'users_unit_fk',
    columns: [t.unitCode, t.unitLevel],
    foreignColumns: [units.code, units.level],
  }),
  // Only one active lead per unit and role (invited/locked/deactivated rows may coexist).
  uniqueIndex('users_one_active_per_unit_idx').on(t.role, t.unitCode).where(sql`${t.status} = 'active'`),
  index('users_unit_code_prefix_idx').on(t.unitCode.op('text_pattern_ops')),
  index('users_invited_by_idx').on(t.invitedBy),

  // Role must sit at the matching unit level (roles.ts ROLE_LEVEL); ADMIN/DG have no unit.
  check('users_role_matches_unit', sql`coalesce(case ${t.role}
    when 'ADMIN' then ${t.unitCode} is null and ${t.unitLevel} is null
    when 'DG' then ${t.unitCode} is null and ${t.unitLevel} is null
    when 'STATE_LEAD' then ${t.unitCode} is not null and ${t.unitLevel} = 'state'
    when 'LGA_LEAD' then ${t.unitCode} is not null and ${t.unitLevel} = 'lga'
    when 'WARD_LEAD' then ${t.unitCode} is not null and ${t.unitLevel} = 'ward'
    when 'PU_LEAD' then ${t.unitCode} is not null and ${t.unitLevel} = 'pu'
  end, false)`),
  check('users_phone_e164_ng_mobile', sql`${t.phone} ~ '^\\+234[789][01][0-9]{8}$'`),
  check('users_active_has_pin', sql`${t.status} <> 'active' or ${t.pinHash} is not null`),
  check('users_full_name_not_blank', sql`length(trim(${t.fullName})) > 0`),
  check('users_failed_pin_attempts_non_negative', sql`${t.failedPinAttempts} >= 0`),
])

export const userDevices = pgTable('user_devices', {
  id: uuid().primaryKey().$defaultFn(newId),
  userId: uuid().notNull().references(() => users.id),
  deviceId: text().notNull(),
  label: text(),
  firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp({ withTimezone: true }),
}, t => [
  uniqueIndex('user_devices_user_device_idx').on(t.userId, t.deviceId),
])

export const invites = pgTable('invites', {
  id: uuid().primaryKey().$defaultFn(newId),
  userId: uuid().notNull().references(() => users.id),
  /** SHA-256 of a 128-bit random token; the token itself is never stored. */
  tokenHash: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
  createdBy: uuid().references(() => users.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('invites_user_id_idx').on(t.userId),
])

export const otpCodes = pgTable('otp_codes', {
  id: uuid().primaryKey().$defaultFn(newId),
  phone: text().notNull(),
  purpose: otpPurpose().notNull(),
  /** HMAC-SHA256 of the code keyed by NUXT_OTP_SECRET (a DB leak alone can't brute-force 6 digits). */
  codeHash: text().notNull(),
  /** Device that passed the PIN check; the code only works for it (2.4). */
  deviceId: text(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  attempts: integer().notNull().default(0),
  consumedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('otp_codes_phone_purpose_created_idx').on(t.phone, t.purpose, t.createdAt),
  // SECURITY §5: max 5 attempts.
  check('otp_codes_attempts_range', sql`${t.attempts} between 0 and 5`),
])

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type UserDevice = typeof userDevices.$inferSelect
export type Invite = typeof invites.$inferSelect
export type OtpCode = typeof otpCodes.$inferSelect
