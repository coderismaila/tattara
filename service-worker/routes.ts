// What the service worker caches (task 4.1, ARCHITECTURE §5, SECURITY_PRIVACY §7). Pure and unit-tested; sw.ts wires
// these into Workbox. The one hard rule: nothing under /api is ever cached (no supporter data in the SW cache).
// Also the request the service worker sends for Background Sync (4.3).
import type { SyncItemResult } from '../shared/types/supporter'

/** Cache for the /app HTML shell (every /app page is the same SPA shell: SSR is off there). */
export const SHELL_CACHE = 'tattara-shell'
/** Cache for the simplified boundary files under /geo (map, 6.3). */
export const GEO_CACHE = 'tattara-geo'
/** Cache for build assets left out of the precache (the map's MapLibre chunk, ADR-047): cached on first use. */
export const ON_DEMAND_CACHE = 'tattara-on-demand'

/** A built asset (hashed, immutable): anything under /_nuxt/. */
export function isBuildAsset(url: URL): boolean {
  return url.pathname.startsWith('/_nuxt/')
}

/** The shell URL fetched at install time and served when /app navigations fail offline. */
export const APP_SHELL_URL = '/app'

export function isApiRequest(url: URL): boolean {
  return url.pathname === '/api' || url.pathname.startsWith('/api/')
}

export function isGeoRequest(url: URL): boolean {
  return url.pathname.startsWith('/geo/')
}

/** A page load of the authenticated app (served network-first, falling back to the cached shell). */
export function isAppNavigation(url: URL, mode: RequestMode): boolean {
  return mode === 'navigate' && (url.pathname === '/app' || url.pathname.startsWith('/app/'))
}

/** Files the build precaches: the app's own assets. Boundary files are cached on use instead (they're large). */
export const PRECACHE_GLOBS = ['**/*.{js,css,html,woff2,ico,png,svg,webmanifest}']
export const PRECACHE_IGNORES = ['geo/**', '**/*.map']

/**
 * The service worker's push sender (Background Sync, task 4.3): same request as the app's, with the session cookie.
 * Throws like $fetch: `statusCode` set when the server answered with an error, unset with no answer.
 */
export async function swPost(items: unknown[], fetcher: typeof fetch = fetch): Promise<{ results: SyncItemResult[] }> {
  const res = await fetcher('/api/sync/push', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  if (!res.ok) throw Object.assign(new Error(`sync push ${res.status}`), { statusCode: res.status })
  return res.json() as Promise<{ results: SyncItemResult[] }>
}
