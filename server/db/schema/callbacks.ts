// Call-back audits (PRD US-10, task 5.3, DATA_MODEL §3): a daily random sample of each ward's new supporters, which
// the ward lead phones to confirm. The ward code (not the lead) is the scope, so a replaced ward lead's open calls go
// to whoever leads the ward now.
import { sql } from 'drizzle-orm'
import { check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { newId } from '../../../shared/utils/uuid.ts'
import { callbackOutcome } from './enums.ts'
import { supporters } from './supporters.ts'
import { units } from './units.ts'
import { users } from './users.ts'

export const callbacks = pgTable('callbacks', {
  id: uuid().primaryKey().$defaultFn(newId),
  // Supporters are only hard-deleted by the dev seed's reset (the app anonymises); their calls go with them.
  supporterId: uuid().notNull().references(() => supporters.id, { onDelete: 'cascade' }),
  wardCode: text().notNull().references(() => units.code),
  /** The ward lead when the sample was drawn (NULL if the ward had none). */
  assignedTo: uuid().references(() => users.id, { onDelete: 'set null' }),
  /** Lagos date the call is due (the day after the supporters were added). */
  dueDate: date({ mode: 'string' }).notNull(),
  outcome: callbackOutcome(),
  /** Short note from the call. Never a phone number (rejected on input). */
  notes: text(),
  completedAt: timestamp({ withTimezone: true }),
  completedBy: uuid().references(() => users.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, t => [
  // A supporter is sampled at most once, ever.
  uniqueIndex('callbacks_supporter_idx').on(t.supporterId),
  index('callbacks_ward_due_idx').on(t.wardCode, t.dueDate),
  check('callbacks_ward_code_is_ward', sql`${t.wardCode} ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}$'`),
  check('callbacks_completed', sql`(${t.outcome} is null) = (${t.completedAt} is null) and (${t.completedAt} is null) = (${t.completedBy} is null)`),
  check('callbacks_notes_length', sql`${t.notes} is null or length(${t.notes}) <= 200`),
])

export type Callback = typeof callbacks.$inferSelect
