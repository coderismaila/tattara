// Supporters, flags and per-PU counters (DATA_MODEL §3–4). Read and written only through server/services/.
// No PVC/VIN, NIN, BVN, religion or ethnicity columns, ever (SECURITY_PRIVACY §9).
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { newId } from '../../../shared/utils/uuid.ts'
import {
  ageBand,
  consentLanguage,
  flagStatus,
  flagType,
  gender,
  hasPvc,
  supporterStatus,
  supportLevel,
  verificationStatus,
} from './enums.ts'
import { geographyPoint } from './types.ts'
import { units } from './units.ts'
import { users } from './users.ts'

export const supporters = pgTable('supporters', {
  /** UUIDv7 generated on the client: the idempotency key for sync (CLAUDE.md rule 5). */
  id: uuid().primaryKey(),
  puCode: text().notNull().references(() => units.code),
  fullName: text().notNull(),
  /** E.164; NULL only once anonymised. */
  phone: text(),
  sharedPhone: boolean().notNull().default(false),
  /** Free text / landmark. */
  address: text(),
  gender: gender(),
  ageBand: ageBand(),
  supportLevel: supportLevel().notNull(),
  /** Yes/no/unsure only: never the PVC or VIN number. */
  hasPvc: hasPvc().notNull(),
  volunteer: boolean().notNull().default(false),
  consentAt: timestamp({ withTimezone: true }).notNull(),
  /** e.g. `c1-ha` (shared/constants/consent.ts). */
  consentVersion: text().notNull(),
  consentLanguage: consentLanguage().notNull(),
  gps: geographyPoint(),
  gpsAccuracyM: integer(),
  /** Device clock at capture. */
  capturedAt: timestamp({ withTimezone: true }).notNull(),
  capturedBy: uuid().notNull().references(() => users.id),
  deviceId: text().notNull(),
  verification: verificationStatus().notNull().default('unverified'),
  status: supporterStatus().notNull().default('active'),
  /** Server receive time. */
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** Server clock; last write wins. */
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid().references(() => users.id),
}, t => [
  // Scope queries (scopeWhere) and sync pulls.
  index('supporters_pu_code_prefix_idx').on(t.puCode.op('text_pattern_ops')),
  index('supporters_phone_idx').on(t.phone),
  index('supporters_captured_by_at_idx').on(t.capturedBy, t.capturedAt),
  index('supporters_pu_code_created_idx').on(t.puCode, t.createdAt),
  index('supporters_gps_gist_idx').using('gist', t.gps),
  // Search (3.4): name "contains" and phone endings, via pg_trgm (enabled in migration 0007).
  index('supporters_full_name_trgm_idx').using('gin', sql`lower(${t.fullName}) gin_trgm_ops`),
  index('supporters_phone_trgm_idx').using('gin', t.phone.op('gin_trgm_ops')),

  check('supporters_id_uuid_v7', sql`substr(${t.id}::text, 15, 1) = '7'`),
  // Supporters sit on a polling unit, never on a ward or above (units' own CHECK ties the shape to the level).
  check('supporters_pu_code_is_pu', sql`${t.puCode} ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}/[0-9]{3}$'`),
  check('supporters_phone', sql`case when ${t.status} = 'anonymised'
    then ${t.phone} is null and ${t.address} is null and ${t.gps} is null
    else ${t.phone} is not null and ${t.phone} ~ '^\\+234[789][01][0-9]{8}$' end`),
  check('supporters_full_name_length', sql`length(trim(${t.fullName})) between 1 and 120`),
  check('supporters_address_length', sql`${t.address} is null or length(${t.address}) <= 200`),
  check('supporters_consent_version', sql`length(trim(${t.consentVersion})) between 1 and 20`),
  check('supporters_gps_accuracy', sql`${t.gpsAccuracyM} is null or ${t.gpsAccuracyM} >= 0`),
  check('supporters_device_id_length', sql`length(${t.deviceId}) between 1 and 100`),
])

export const flags = pgTable('flags', {
  id: uuid().primaryKey().$defaultFn(newId),
  supporterId: uuid().references(() => supporters.id),
  /** The lead a flag is about (e.g. rate_anomaly). */
  userId: uuid().references(() => users.id),
  puCode: text().notNull().references(() => units.code),
  type: flagType().notNull(),
  /** Evidence (distances, counts). Never names or phone numbers. */
  details: jsonb().notNull().default({}),
  status: flagStatus().notNull().default('open'),
  reviewedBy: uuid().references(() => users.id),
  reviewedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('flags_pu_code_prefix_idx').on(t.puCode.op('text_pattern_ops')),
  index('flags_status_created_idx').on(t.status, t.createdAt),
  index('flags_supporter_idx').on(t.supporterId),
  // The flag engine (5.1) re-runs: at most one open flag of a type per supporter.
  uniqueIndex('flags_one_open_per_supporter_type_idx').on(t.supporterId, t.type).where(sql`${t.status} = 'open' and ${t.supporterId} is not null`),
  // PU-level flags (pu_over_capacity): one open per PU and type. Lead-level flags (rate_anomaly): one open per lead.
  uniqueIndex('flags_one_open_per_pu_type_idx').on(t.puCode, t.type).where(sql`${t.status} = 'open' and ${t.supporterId} is null and ${t.userId} is null`),
  uniqueIndex('flags_one_open_per_user_type_idx').on(t.userId, t.type).where(sql`${t.status} = 'open' and ${t.supporterId} is null and ${t.userId} is not null`),
  index('flags_user_idx').on(t.userId),
  check('flags_review', sql`(${t.status} = 'open') = (${t.reviewedAt} is null)`),
])

/** Per-PU counters, updated in the same transaction as supporter writes (ARCHITECTURE §7). */
export const puStats = pgTable('pu_stats', {
  puCode: text().primaryKey().references(() => units.code),
  total: integer().notNull().default(0),
  /** SMS delivered or call-back verified (ADR-027). */
  verified: integer().notNull().default(0),
  flaggedOpen: integer().notNull().default(0),
  male: integer().notNull().default(0),
  female: integer().notNull().default(0),
  age18_24: integer('age_18_24').notNull().default(0),
  age25_34: integer('age_25_34').notNull().default(0),
  age35_44: integer('age_35_44').notNull().default(0),
  age45_54: integer('age_45_54').notNull().default(0),
  age55_64: integer('age_55_64').notNull().default(0),
  age65Plus: integer('age_65_plus').notNull().default(0),
  strong: integer().notNull().default(0),
  leaning: integer().notNull().default(0),
  undecided: integer().notNull().default(0),
  hasPvcYes: integer().notNull().default(0),
  volunteers: integer().notNull().default(0),
  optedOut: integer().notNull().default(0),
  lastCaptureAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('pu_stats_pu_code_prefix_idx').on(t.puCode.op('text_pattern_ops')),
  check('pu_stats_non_negative', sql`least(${t.total}, ${t.verified}, ${t.flaggedOpen}, ${t.male}, ${t.female},
    ${t.age18_24}, ${t.age25_34}, ${t.age35_44}, ${t.age45_54}, ${t.age55_64}, ${t.age65Plus},
    ${t.strong}, ${t.leaning}, ${t.undecided}, ${t.hasPvcYes}, ${t.volunteers}, ${t.optedOut}) >= 0`),
])

export type Supporter = typeof supporters.$inferSelect
export type NewSupporter = typeof supporters.$inferInsert
export type Flag = typeof flags.$inferSelect
export type PuStats = typeof puStats.$inferSelect
