// Geography (DATA_MODEL §1): one table for every level, keyed by the INEC code `SS/LL/WW/PPP`.
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, timestamp, unique, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { unitLevel } from './enums.ts'
import { geographyPoint } from './types.ts'

export const units = pgTable('units', {
  code: text().primaryKey(),
  level: unitLevel().notNull(),
  parentCode: text().references((): AnyPgColumn => units.code),
  name: text().notNull(),
  nameNormalised: text().notNull(),
  registeredVoters: integer(),
  location: geographyPoint(),
  /** True when `location` is a fallback (e.g. ward centroid), not an INEC PU coordinate. */
  locationEstimated: boolean().notNull().default(false),
  boundaryRef: text(),
  active: boolean().notNull().default(true),
  sourceVersion: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('units_parent_code_idx').on(t.parentCode),
  index('units_level_idx').on(t.level),
  // Scope queries: `code LIKE '19/05/%'` (ARCHITECTURE §4).
  index('units_code_prefix_idx').on(t.code.op('text_pattern_ops')),
  index('units_location_gist_idx').using('gist', t.location),
  // Target of users(unit_code, unit_level) so a lead's role level must match the unit's level.
  unique('units_code_level_key').on(t.code, t.level),

  // Defence in depth for imports: the code's shape matches its level, and the parent is the code minus
  // its last segment. IS NOT DISTINCT FROM so a NULL parent can't slip through; COALESCE so NULL ⇒ fail.
  check('units_code_matches_level', sql`coalesce(case ${t.level}
    when 'state' then ${t.code} ~ '^[0-9]{2}$' and ${t.parentCode} is null
    when 'lga' then ${t.code} ~ '^[0-9]{2}/[0-9]{2}$' and ${t.parentCode} is not distinct from left(${t.code}, 2)
    when 'ward' then ${t.code} ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}$' and ${t.parentCode} is not distinct from left(${t.code}, 5)
    when 'pu' then ${t.code} ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}/[0-9]{3}$' and ${t.parentCode} is not distinct from left(${t.code}, 8)
  end, false)`),
  check('units_name_not_blank', sql`length(trim(${t.name})) > 0`),
  check('units_registered_voters_non_negative', sql`${t.registeredVoters} is null or ${t.registeredVoters} >= 0`),
])

export type Unit = typeof units.$inferSelect
export type NewUnit = typeof units.$inferInsert
