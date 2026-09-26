// Fixed-window counters for rate limits (ARCHITECTURE §6). In Postgres so limits hold across server instances.
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const rateLimits = pgTable('rate_limits', {
  /** SHA-256 of the logical key (e.g. `login:+234…`), so phones are not stored in the clear. */
  key: text().primaryKey(),
  windowStart: timestamp({ withTimezone: true }).notNull().defaultNow(),
  count: integer().notNull().default(0),
})
