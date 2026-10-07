// Task 4.3 (ARCHITECTURE §5): when the sync engine runs. On start, when the phone comes back online, every minute
// while online, when the page is shown again, after a sign-in (useLocalSignIn) and when the service worker says it
// synced in the background. Runs are skipped without a local session (signed out or wiped).
import { requestPersistentStorage } from '~/offline/background'
import { getLocalSession } from '~/offline/local-session'
import { SYNC_INTERVAL_MS } from '~~/shared/constants/sync'

export default defineNuxtPlugin((nuxtApp) => {
  const sync = useSync()

  window.addEventListener('online', () => void sync.run({ force: true }))
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void sync.run()
  }, SYNC_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync.run()
  })
  // The service worker pushed in the background (Background Sync): refresh counts and pull.
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if ((event.data as { type?: string } | null)?.type === 'TATTARA_SYNCED') void sync.run()
  })
  nuxtApp.hook('app:mounted', async () => {
    if (await getLocalSession().catch(() => undefined)) void requestPersistentStorage()
    void sync.run({ force: true })
  })
})
