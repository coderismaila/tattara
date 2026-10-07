// Idle lock timing (SECURITY_PRIVACY §7: lock after 5 min idle). The last-activity time lives in localStorage so a
// cold start knows how long the app was closed; it is a timestamp, not supporter data.

export const LAST_ACTIVE_STORAGE_KEY = 'tattara:lastActive'
export const DEFAULT_LOCK_IDLE_MINUTES = 5

/**
 * True when the app should be locked: no recorded activity, idle for `idleMs` or more, or a last-activity time in
 * the future (the clock was moved back, so the idle time can't be trusted).
 */
export function isIdleExpired(lastActive: number | null, now: number, idleMs: number): boolean {
  if (lastActive === null || !Number.isFinite(lastActive)) return true
  if (lastActive > now) return true
  return now - lastActive >= idleMs
}

export function readLastActive(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_STORAGE_KEY)
    return raw === null ? null : Number(raw)
  }
  catch {
    return null
  }
}

export function writeLastActive(at: number): void {
  try {
    localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(at))
  }
  catch {
    // Storage blocked: the app then locks on every start, which is the safe side.
  }
}
