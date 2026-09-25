// audit_log (DATA_MODEL §5): append-only. A trigger (migration 0003) rejects UPDATE/DELETE/TRUNCATE;
// in deployment the app role additionally gets INSERT/SELECT only (SECURITY_PRIVACY §6).
import { bigint, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { userRole } from './enums.ts'
import { users } from './users.ts'

export const auditLog = pgTable('audit_log', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** NULL for system actions (tasks, CLI). */
  actorId: uuid().references(() => users.id),
  actorRole: userRole(),
  action: text().notNull(),
  targetType: text(),
  targetId: text(),
  scopeCode: text(),
  ip: inet(),
  /** IDs, codes and field names only; never names, phones, addresses or GPS (SECURITY §8). */
  meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
}, t => [
  index('audit_log_at_idx').on(t.at),
  index('audit_log_actor_at_idx').on(t.actorId, t.at),
  index('audit_log_scope_code_prefix_idx').on(t.scopeCode.op('text_pattern_ops')),
])

export type AuditLogEntry = typeof auditLog.$inferSelect
export type NewAuditLogEntry = typeof auditLog.$inferInsert
