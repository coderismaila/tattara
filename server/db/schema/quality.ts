// Per-unit aggregates rebuilt by nightly tasks (no personal data): lead quality (PRD R-7, task 5.5, ADR-044) and the
// daily snapshot for trend charts (task 6.1).
import { sql } from 'drizzle-orm'
import { check, date, integer, pgTable, primaryKey, real, text, timestamp } from 'drizzle-orm/pg-core'
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

/**
 * Daily snapshot per unit for trend charts (ARCHITECTURE §7, task 6.1), written by `stats:daily` at 23:55 Lagos.
 * `unit_code` is a unit code, or `all` for the region (so no FK). Cumulative totals as of that day.
 */
export const unitDailyStats = pgTable('unit_daily_stats', {
  unitCode: text().notNull(),
  /** Lagos calendar date. */
  day: date({ mode: 'string' }).notNull(),
  total: integer().notNull(),
  verified: integer().notNull(),
}, t => [
  primaryKey({ columns: [t.unitCode, t.day] }),
  check('unit_daily_stats_non_negative', sql`${t.total} >= 0 and ${t.verified} >= 0`),
])

export type UnitDailyStats = typeof unitDailyStats.$inferSelect
