// Build-time precache filter (task 6.3, ADR-047). Runs in Node while the PWA plugin builds the precache manifest, not in
// the service worker. Chunks only the map needs (MapLibre, ~1 MB raw / 285 KB gzip) are left out, so a PU lead's phone
// never downloads them; the service worker caches them on first use instead (ON_DEMAND_CACHE).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A string only MapLibre's bundle contains (its canvas class name). */
export const ON_DEMAND_MARKERS = ['maplibregl-canvas'] as const

export function isOnDemandChunk(source: string): boolean {
  return ON_DEMAND_MARKERS.some(m => source.includes(m))
}

interface ManifestEntry { url: string, size: number, revision: string | null }

/** A Workbox `manifestTransforms` entry: drop on-demand chunks (paths relative to `publicDir`). */
export function dropOnDemandChunks(publicDir: string) {
  return async (entries: ManifestEntry[]) => {
    const manifest = entries.filter((e) => {
      if (!e.url.endsWith('.js')) return true
      try {
        return !isOnDemandChunk(readFileSync(join(publicDir, e.url), 'utf8'))
      }
      catch {
        return true
      }
    })
    return { manifest, warnings: [] }
  }
}
