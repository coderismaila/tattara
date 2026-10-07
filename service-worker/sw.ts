/// <reference lib="webworker" />
// Tattara service worker (task 4.1): precache the app, serve the /app shell offline, cache boundary files, and never
// cache the API. Updates wait for the lead to tap "Reload" (registerType: 'prompt'). Task 4.3: Background Sync sends
// the outbox when the connection is back, even with the app closed.
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies'
import { SYNC_TAG } from '../shared/constants/sync'
import { runSync } from '../app/offline/sync'
import { APP_SHELL_URL, GEO_CACHE, SHELL_CACHE, isApiRequest, isAppNavigation, isGeoRequest, swPost } from './routes'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string, revision: string | null })[] }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// The API always goes to the network and is never stored (SECURITY_PRIVACY §7).
registerRoute(({ url }) => isApiRequest(url), new NetworkOnly())

// Boundary GeoJSON: large and rarely changing, so keep what was used.
registerRoute(({ url }) => isGeoRequest(url), new CacheFirst({
  cacheName: GEO_CACHE,
  plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 })],
}))

// /app pages: network first (fresh shell after a deploy), the cached shell when offline or on a very slow link.
const shell = new NetworkFirst({ cacheName: SHELL_CACHE, networkTimeoutSeconds: 3 })
registerRoute(({ url, request }) => isAppNavigation(url, request.mode), async (options) => {
  try {
    return await shell.handle(options)
  }
  catch {
    const cached = await (await caches.open(SHELL_CACHE)).match(APP_SHELL_URL)
    return cached ?? Response.error()
  }
})

// Keep a shell ready for the first offline start, whichever /app page the lead opens first.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.add(APP_SHELL_URL)).catch(() => {}))
})

// Background Sync (capture registers SYNC_TAG when a save couldn't be sent). Push only, under the same Web Lock as the
// app's engine; the open app (if any) is told so it can refresh its counts and pull. A failed push throws so the
// browser retries later (Chrome: a few times, with its own backoff).
interface SyncEvent extends ExtendableEvent { tag: string }
self.addEventListener('sync', ((event: SyncEvent) => {
  if (event.tag !== SYNC_TAG) return
  event.waitUntil((async () => {
    const report = await runSync({ force: true, pull: false, post: swPost })
    const windows = await self.clients.matchAll({ type: 'window' })
    for (const client of windows) client.postMessage({ type: 'TATTARA_SYNCED' })
    if (report.pushError !== undefined && report.pushError !== 401 && report.pushError !== 403) {
      throw new Error('sync push unanswered')
    }
  })())
}) as EventListener)

// "Reload" in the update prompt posts SKIP_WAITING (vite-plugin-pwa's prompt flow).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})
clientsClaim()
