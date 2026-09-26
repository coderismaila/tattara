// audit_log writes (CLAUDE.md rule 6): exports, role changes, account creation, deletions, bulk SMS, …
// meta holds IDs, codes and field names only — never PII (SECURITY_PRIVACY §8). The guard below enforces that.
// Pure (DB injected): usable from services, scripts and tests. The request-aware audit(event) is in server/utils/audit.ts.
import type { Db } from '../db/client.ts'
import { auditLog, type AuditLogEntry } from '../db/schema/index.ts'
import type { SessionUser } from '../../shared/types/auth.ts'

export interface AuditInput {
  /** Dotted verb, e.g. `user.invite`, `export.approve`, `sms.broadcast`. */
  action: string
  targetType?: string
  targetId?: string
  /** Unit code the action concerns (enables scoped audit views). */
  scopeCode?: string
  meta?: Record<string, unknown>
}

export interface AuditActor {
  id: string | null
  role: SessionUser['role'] | null
  ip: string | null
}

export class AuditPiiError extends Error {
  override name = 'AuditPiiError'
}

/** Keys that must never appear in audit meta (any nesting level, case-insensitive). */
const FORBIDDEN_KEYS = /^(?:name|full_?name|first_?name|last_?name|phone|to_?phone|msisdn|address|gps|lat|lng|latitude|longitude|location|pin|otp|password|token|body|sms)$/i
/** Values that look like Nigerian phone numbers (E.164 or local). */
const PHONE_LIKE = /(?:\+?234|\b0)[789][01]\d{8}\b/

/** Throws AuditPiiError if `meta` contains a forbidden key or a phone-like value. */
export function assertAuditMetaSafe(meta: unknown, path = 'meta'): void {
  if (typeof meta === 'string') {
    if (PHONE_LIKE.test(meta)) throw new AuditPiiError(`${path} looks like a phone number`)
    return
  }
  if (Array.isArray(meta)) {
    meta.forEach((v, i) => assertAuditMetaSafe(v, `${path}[${i}]`))
    return
  }
  if (meta && typeof meta === 'object') {
    for (const [key, value] of Object.entries(meta)) {
      if (FORBIDDEN_KEYS.test(key)) throw new AuditPiiError(`${path}.${key} is not allowed in audit meta`)
      assertAuditMetaSafe(value, `${path}.${key}`)
    }
  }
}

/** Write an audit entry for an explicit actor (scripts, tasks, CLI). */
export async function recordAudit(db: Db, actor: AuditActor, input: AuditInput): Promise<AuditLogEntry> {
  const meta = input.meta ?? {}
  assertAuditMetaSafe(meta)
  const [row] = await db.insert(auditLog).values({
    actorId: actor.id,
    actorRole: actor.role,
    ip: actor.ip,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    scopeCode: input.scopeCode,
    meta,
  }).returning()
  return row!
}
