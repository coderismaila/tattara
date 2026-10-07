// Sign out of this phone (task 4.5): end the server session when reachable, wipe all local data, go to /login.
// Also used after too many wrong PINs and when the server reports the session revoked.
import { wipeDevice } from '~/offline/db'

export function useSignOut() {
  const { clear } = useUserSession()
  const lock = useAppLock()
  const router = useRouter()

  return async function signOut(options: { callServer?: boolean } = {}) {
    if (options.callServer !== false) {
      // Offline this fails; the wiped phone can't be unlocked anyway, and the next online visit asks to sign in.
      await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    }
    await wipeDevice().catch(() => {})
    await clear().catch(() => {})
    lock.reset()
    await router.replace('/login')
  }
}
