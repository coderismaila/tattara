// The lead's session as this phone remembers it (task 4.5): who signed in, their unit, and the PIN verifier that
// unlocks the app offline. Saved at sign-in, refreshed from /api/auth/me while online, wiped with everything else.
import type { Role } from '~~/shared/constants/roles'
import { db, getMeta, setMeta, wipeDevice } from './db'
import { createPinVerifier, verifyPin, type PinVerifier } from './pin-verifier'

/** Wrong PINs on the lock screen before the phone is wiped (same as the server's lockout count). */
export const MAX_UNLOCK_FAILURES = 5

export interface LocalSession {
  userId: string
  fullName: string
  role: Role
  unitCode: string | null
  unit: { code: string, name: string, level: string } | null
  savedAt: string
}

/** The shape of GET /api/auth/me that the snapshot is built from. */
export interface MeResponse {
  user: { id: string, fullName: string, role: Role, unitCode: string | null }
  unit: { code: string, name: string, level: string } | null
}

const SESSION_KEY = 'session'
const VERIFIER_KEY = 'pinVerifier'
const FAILURES_KEY = 'unlockFailures'

export const getLocalSession = () => getMeta<LocalSession>(SESSION_KEY)

function snapshot(me: MeResponse): LocalSession {
  return {
    userId: me.user.id,
    fullName: me.user.fullName,
    role: me.user.role,
    unitCode: me.user.unitCode,
    unit: me.unit,
    savedAt: new Date().toISOString(),
  }
}

/**
 * After a successful online sign-in (PIN known). A different lead's data on this phone is wiped first, so one lead
 * never opens another's records.
 */
export async function startLocalSession(me: MeResponse, pin: string): Promise<void> {
  const previous = await getLocalSession().catch(() => undefined)
  if (previous && previous.userId !== me.user.id) await wipeDevice()
  const verifier = await createPinVerifier(pin)
  await db.transaction('rw', db.meta, async () => {
    await setMeta(SESSION_KEY, snapshot(me))
    await setMeta(VERIFIER_KEY, verifier)
    await setMeta(FAILURES_KEY, 0)
  })
}

/** Keep the snapshot current (role or unit changes) while online. Ignored for a different user. */
export async function refreshLocalSession(me: MeResponse): Promise<void> {
  const current = await getLocalSession()
  if (current?.userId === me.user.id) await setMeta(SESSION_KEY, snapshot(me))
}

/** The app can lock only when it can also unlock: a session snapshot and a PIN verifier are both on the phone. */
export async function canUnlockOffline(): Promise<boolean> {
  const [session, verifier] = await Promise.all([getLocalSession(), getMeta<PinVerifier>(VERIFIER_KEY)])
  return !!session && !!verifier
}

export type UnlockResult
  = | { ok: true }
    | { ok: false, wiped: false, remaining: number }
    | { ok: false, wiped: true }

/** Check a PIN on the lock screen. The failure count survives reloads; the last allowed failure wipes the phone. */
export async function unlockWithPin(pin: string): Promise<UnlockResult> {
  const verifier = await getMeta<PinVerifier>(VERIFIER_KEY)
  if (!verifier) {
    await wipeDevice()
    return { ok: false, wiped: true }
  }
  if (await verifyPin(pin, verifier)) {
    await setMeta(FAILURES_KEY, 0)
    return { ok: true }
  }
  const failures = ((await getMeta<number>(FAILURES_KEY)) ?? 0) + 1
  if (failures >= MAX_UNLOCK_FAILURES) {
    await wipeDevice()
    return { ok: false, wiped: true }
  }
  await setMeta(FAILURES_KEY, failures)
  return { ok: false, wiped: false, remaining: MAX_UNLOCK_FAILURES - failures }
}
