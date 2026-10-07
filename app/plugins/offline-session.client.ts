// Task 4.5: drives the idle lock (activity, a timer, page visibility) and checks the session with the server whenever
// the phone is online, so a revoked lead's phone is wiped on its next contact (SECURITY_PRIVACY §7).
import { getLocalSession, refreshLocalSession, type MeResponse } from '~/offline/local-session'

/** The server is asked at most this often (plus whenever the phone comes back online). */
const SERVER_CHECK_MS = 60_000
const IDLE_CHECK_MS = 15_000

export default defineNuxtPlugin((nuxtApp) => {
  const lock = useAppLock()
  const signOut = useSignOut()
  const { clear } = useUserSession()
  const router = useRouter()
  let lastServerCheck = 0
  let checking = false

  async function checkServer(force = false) {
    if (!navigator.onLine || checking) return
    if (!force && Date.now() - lastServerCheck < SERVER_CHECK_MS) return
    const local = await getLocalSession().catch(() => undefined)
    if (!local) return
    checking = true
    lastServerCheck = Date.now()
    try {
      const me = await $fetch<MeResponse>('/api/auth/me')
      // A cookie for someone else than the phone's lead: never show one lead another's data.
      if (me.user.id !== local.userId) await signOut()
      else await refreshLocalSession(me)
    }
    catch (error) {
      const e = error as { statusCode?: number, data?: { data?: { reason?: string } } }
      if (e.statusCode !== 401) return // offline, server down: try later
      if (e.data?.data?.reason === 'revoked') {
        await signOut({ callServer: false })
      }
      else {
        // Expired: keep the data for this lead's next sign-in.
        await clear().catch(() => {})
        const path = router.currentRoute.value.fullPath
        if (path.startsWith('/app')) await router.replace({ path: '/login', query: { next: path } })
      }
    }
    finally {
      checking = false
    }
  }

  const onActivity = () => lock.touch()
  for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(type, onActivity, { capture: true, passive: true })
  }
  window.setInterval(() => lock.check(), IDLE_CHECK_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    lock.check()
    void checkServer()
  })
  window.addEventListener('online', () => void checkServer(true))
  nuxtApp.hook('app:mounted', () => void checkServer(true))
})
