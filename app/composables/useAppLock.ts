// The idle lock (task 4.5, SECURITY_PRIVACY §7). The app layout hides /app behind the lock screen unless the state is
// `unlocked`; the offline-session plugin feeds it activity and checks the idle time.
import { DEFAULT_LOCK_IDLE_MINUTES, isIdleExpired, readLastActive, writeLastActive } from '~/offline/idle'
import { canUnlockOffline, unlockWithPin, type UnlockResult } from '~/offline/local-session'

/**
 * `checking`: deciding (the screen stays covered). `locked`: PIN needed. `needsSignIn`: this phone has no local
 * session or PIN verifier, so it can't be unlocked offline; the lead must sign in online.
 */
export type LockState = 'checking' | 'unlocked' | 'locked' | 'needsSignIn'

/** Activity is written to storage at most this often. */
const TOUCH_THROTTLE_MS = 10_000

export function useAppLock() {
  const state = useState<LockState>('app-lock', () => 'checking')
  const lastTouch = useState('app-lock:last-touch', () => 0)
  const config = useRuntimeConfig()
  const idleMs = () => (Number(config.public.lockIdleMinutes) || DEFAULT_LOCK_IDLE_MINUTES) * 60_000

  function markActive() {
    const now = Date.now()
    lastTouch.value = now
    writeLastActive(now)
  }

  /** Record activity while unlocked (pointer, key, page shown). */
  function touch() {
    if (state.value !== 'unlocked') return
    if (Date.now() - lastTouch.value >= TOUCH_THROTTLE_MS) markActive()
  }

  /** Lock if the idle time has run out. Call on a timer and when the page becomes visible. */
  function check() {
    if (state.value === 'unlocked' && isIdleExpired(readLastActive(), Date.now(), idleMs())) state.value = 'locked'
  }

  /** Decide the state when the app opens (layout mount). */
  async function evaluate() {
    let canUnlock = false
    try {
      canUnlock = await canUnlockOffline()
    }
    catch {
      // IndexedDB unavailable: treat as no local session.
    }
    if (!canUnlock) {
      state.value = 'needsSignIn'
      return
    }
    if (state.value === 'unlocked') {
      check()
      return
    }
    if (isIdleExpired(readLastActive(), Date.now(), idleMs())) {
      state.value = 'locked'
    }
    else {
      state.value = 'unlocked'
      markActive()
    }
  }

  async function unlock(pin: string): Promise<UnlockResult> {
    const result = await unlockWithPin(pin)
    if (result.ok) {
      state.value = 'unlocked'
      markActive()
    }
    else if (result.wiped) {
      state.value = 'needsSignIn'
    }
    return result
  }

  /** After an online sign-in has saved the local session. */
  function signedIn() {
    state.value = 'unlocked'
    markActive()
  }

  /** After sign-out or a wipe: the next /app visit decides again. */
  function reset() {
    state.value = 'checking'
  }

  return { state: readonly(state), touch, check, evaluate, unlock, signedIn, reset }
}
