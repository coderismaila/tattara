// Lead quality per unit (PRD R-7, task 5.5, ADR-044): rebuilt nightly from the supporters, flags and call-backs of the
// last 90 days. Aggregates only, no personal data.
import { sql } from 'drizzle-orm'
import { check, integer, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core'
import { units } from './units.ts'

export const unitQuality = pgTable('unit_quality', {
  unitCode: text().primaryKey().references(() => units.code, { onDelete: 'cascade' }),
  /** 0–100; NULL with too few supporters to judge. */
  score: integer(),
  verifiedRate: real().notNull(),
  flagRate: real().notNull(),
  optOutRate: real().notNull(),
  /** NULL with too few answered call-backs. */
  passRate: real(),
  supporters: integer().notNull(),
  computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  check('unit_quality_score_range', sql`${t.score} is null or ${t.score} between 0 and 100`),
])

export type UnitQuality = typeof unitQuality.$inferSelect
