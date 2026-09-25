import { sql } from 'drizzle-orm'
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { units } from './units.ts'
import { users } from './users.ts'

export const unitTargets = pgTable('unit_targets', {
  unitCode: text().primaryKey().references(() => units.code),
  target: integer().notNull(),
  setBy: uuid().references(() => users.id),
  setAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  check('unit_targets_target_non_negative', sql`${t.target} >= 0`),
])

export type UnitTarget = typeof unitTargets.$inferSelect
