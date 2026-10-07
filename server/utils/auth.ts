// Request authentication (ARCHITECTURE §6, SECURITY_PRIVACY §5). requireAuth runs on every authenticated request:
// the sealed cookie alone is not enough — the user must still be active, on the same session_version, on a device
// that has not been revoked, and active within the last 30 days.
import { and, eq, isNull, sql } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import { userDevices, users } from '../db/schema/index.ts'
import type { SecureSession, SessionUser } from '../../shared/types/auth.ts'
import { clearUserSession, getUserSession, replaceUserSession, setUserSession } from '../auth/session.ts'
import { useDb } from './db.ts'

/** Sessions end after this long without activity (ARCHITECTURE §6: 30 days sliding). */
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000
/** Activity refreshes the session (and users.last_seen_at) at most this often. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000

export interface AuthContext {
  user: SessionUser
  deviceId: string
}

/**
 * `revoked`: the account or device was shut off (deactivated, PIN reset, device revoked), so the client wipes its
 * local data (SECURITY_PRIVACY §7). `expired`: no session or 30 days idle; the client keeps its data for the same
 * lead's next sign-in. Only someone who held a valid session ever sees `revoked`.
 */
export type UnauthorizedReason = 'revoked' | 'expired'

const unauthorized = (reason: UnauthorizedReason = 'expired') =>
  createError({ statusCode: 401, statusMessage: 'Unauthorized', data: { reason } })

/** Start a session after a successful login, OTP or setup. Replaces any previous session data. */
export async function startSession(event: H3Event, user: SessionUser, deviceId: string): Promise<void> {
  const now = Date.now()
  const secure: SecureSession = { deviceId, refreshedAt: now, loggedInAt: now }
  await replaceUserSession(event, { user, secure })
}

export async function endSession(event: H3Event): Promise<void> {
  await clearUserSession(event)
}

/**
 * The authenticated user for this request, re-validated against the DB (once per request). 401 otherwise, and the
 * stale session is cleared. Role and unit come from the DB, not the cookie, so changes apply immediately.
 */
export async function requireAuth(event: H3Event): Promise<AuthContext> {
  const cached = event.context.auth as AuthContext | undefined
  if (cached) return cached

  const session = await getUserSession(event)
  const secure = session.secure
  if (secure?.revoked) throw unauthorized('revoked')
  if (!session.user || !secure?.deviceId || !secure.refreshedAt) throw unauthorized()

  const now = Date.now()
  if (now - secure.refreshedAt > SESSION_IDLE_MS) {
    await clearUserSession(event)
    throw unauthorized()
  }

  const [row] = await useDb().select({
    id: users.id,
    role: users.role,
    unitCode: users.unitCode,
    sessionVersion: users.sessionVersion,
    status: users.status,
    deviceOk: sql<boolean>`exists (select 1 from ${userDevices} where ${and(
      eq(userDevices.userId, users.id),
      eq(userDevices.deviceId, secure.deviceId),
      isNull(userDevices.revokedAt),
    )})`,
  }).from(users).where(eq(users.id, session.user.id))

  // Deactivated, PIN reset (session_version bump), or device revoked ("wipe this device"). The user is dropped from
  // the session and a revoked marker stays, so every later request also says `revoked` (the phone must wipe).
  if (!row || row.status !== 'active' || row.sessionVersion !== session.user.sessionVersion || !row.deviceOk) {
    await replaceUserSession(event, { secure: { revoked: true } })
    throw unauthorized('revoked')
  }

  const user: SessionUser = { id: row.id, role: row.role, unitCode: row.unitCode, sessionVersion: row.sessionVersion }
  if (now - secure.refreshedAt > SESSION_REFRESH_MS) {
    await setUserSession(event, { user, secure: { ...secure, refreshedAt: now } })
    await useDb().update(users).set({ lastSeenAt: sql`now()` }).where(eq(users.id, user.id))
  }

  const ctx: AuthContext = { user, deviceId: secure.deviceId }
  event.context.auth = ctx
  return ctx
}
