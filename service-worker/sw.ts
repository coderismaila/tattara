/// <reference lib="webworker" />
// Tattara service worker (task 4.1): precache the app, serve the /app shell offline, cache boundary files, and never
// cache the API. Updates wait for the lead to tap "Reload" (registerType: 'prompt').
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies'
import { APP_SHELL_URL, GEO_CACHE, SHELL_CACHE, isApiRequest, isAppNavigation, isGeoRequest } from './routes'

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

// "Reload" in the update prompt posts SKIP_WAITING (vite-plugin-pwa's prompt flow).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})
clientsClaim()
