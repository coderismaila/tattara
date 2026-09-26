// Audit the current request's user (or a system entry if there is no session). The pure writer and PII guard live
// in server/services/audit.ts.
import { getRequestIP, type H3Event } from 'h3'
import { recordAudit, type AuditInput } from '../services/audit.ts'
import type { AuditLogEntry } from '../db/schema/index.ts'
import { getUserSession } from '../auth/session.ts'
import { useDb } from './db.ts'

export { AuditPiiError, assertAuditMetaSafe, recordAudit, type AuditActor, type AuditInput } from '../services/audit.ts'

/** Write an audit entry for the current request's user (or a system entry if there is no session). */
export async function audit(event: H3Event, input: AuditInput): Promise<AuditLogEntry> {
  const { user } = await getUserSession(event)
  const ip = getRequestIP(event) ?? null
  return recordAudit(useDb(), { id: user?.id ?? null, role: user?.role ?? null, ip }, input)
}
