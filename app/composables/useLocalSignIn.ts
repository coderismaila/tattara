// After an online sign-in (login, OTP or invite setup): remember the lead on this phone so the app can be unlocked
// offline with the same PIN (task 4.5).
import { startLocalSession, type MeResponse } from '~/offline/local-session'

export function useLocalSignIn() {
  const lock = useAppLock()

  /** Throws if the phone's storage refuses the local session; the caller shows `auth.errors.deviceStorage`. */
  return async function rememberSignIn(pin: string) {
    const me = await $fetch<MeResponse>('/api/auth/me')
    await startLocalSession(me, pin)
    lock.signedIn()
  }
}
