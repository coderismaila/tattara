// sms_queue (DATA_MODEL §5, ARCHITECTURE §9): every outbound SMS goes through here, processed by the
// `sms:process` Nitro task, which gives retries with backoff and a record of what was sent.
import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { newId } from '../../../shared/utils/uuid.ts'
import { smsPurpose, smsStatus } from './enums.ts'
import { users } from './users.ts'

export const smsQueue = pgTable('sms_queue', {
  id: uuid().primaryKey().$defaultFn(newId),
  /** E.164 Nigerian mobile. */
  toPhone: text().notNull(),
  body: text().notNull(),
  templateKey: text(),
  purpose: smsPurpose().notNull(),
  /** Unit code the send is attributed to (per-scope caps and reporting). */
  scopeCode: text(),
  status: smsStatus().notNull().default('queued'),
  attempts: integer().notNull().default(0),
  /** When the processor may (re)try; NULL once no longer queued. */
  nextAttemptAt: timestamp({ withTimezone: true }).defaultNow(),
  /** Provider error text only; never the message body or phone. */
  lastError: text(),
  providerRef: text(),
  createdBy: uuid().references(() => users.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp({ withTimezone: true }),
}, t => [
  // The processor's claim query: due queued messages, oldest first.
  index('sms_queue_due_idx').on(t.status, t.nextAttemptAt),
  index('sms_queue_to_phone_idx').on(t.toPhone, t.createdAt),
  check('sms_queue_to_phone_e164_ng_mobile', sql`${t.toPhone} ~ '^\\+234[789][01][0-9]{8}$'`),
  check('sms_queue_body_not_blank', sql`length(trim(${t.body})) > 0`),
  check('sms_queue_attempts_non_negative', sql`${t.attempts} >= 0`),
])

export type SmsQueueRow = typeof smsQueue.$inferSelect
export type NewSmsQueueRow = typeof smsQueue.$inferInsert
