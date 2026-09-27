import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_SHELL_URL, PRECACHE_IGNORES, isApiRequest, isAppNavigation, isGeoRequest } from '../../service-worker/routes'

const url = (path: string) => new URL(path, 'https://tattara.test')

describe('service worker routes', () => {
  it.each(['/api/supporters', '/api/supporters/abc', '/api/sync/push', '/api/auth/me', '/api'])('never caches %s', (path) => {
    expect(isApiRequest(url(path))).toBe(true)
    expect(isGeoRequest(url(path))).toBe(false)
    expect(isAppNavigation(url(path), 'navigate')).toBe(false)
  })

  it('does not mistake look-alikes for the API', () => {
    expect(isApiRequest(url('/apiary'))).toBe(false)
    expect(isApiRequest(url('/app/api'))).toBe(false)
  })

  it('caches boundary files on use', () => {
    expect(isGeoRequest(url('/geo/nw-states.geojson'))).toBe(true)
    expect(isGeoRequest(url('/geo/wards/19.geojson'))).toBe(true)
    expect(isGeoRequest(url('/geography'))).toBe(false)
  })

  it('serves /app page loads (only page loads) from the shell', () => {
    expect(isAppNavigation(url('/app'), 'navigate')).toBe(true)
    expect(isAppNavigation(url('/app/supporters/0192'), 'navigate')).toBe(true)
    expect(isAppNavigation(url('/app/capture'), 'cors')).toBe(false)
    expect(isAppNavigation(url('/apple'), 'navigate')).toBe(false)
    expect(isAppNavigation(url('/login'), 'navigate')).toBe(false)
    expect(APP_SHELL_URL).toBe('/app')
  })

  it('leaves the large boundary files out of the precache', () => {
    expect(PRECACHE_IGNORES).toContain('geo/**')
  })

  it('the service worker registers no caching route for the API', () => {
    const sw = readFileSync(new URL('../../service-worker/sw.ts', import.meta.url), 'utf8')
    expect(sw).toMatch(/registerRoute\(\(\{ url \}\) => isApiRequest\(url\), new NetworkOnly\(\)\)/)
    expect(sw).not.toMatch(/isApiRequest\(url\)[^\n]*(?:CacheFirst|StaleWhileRevalidate|NetworkFirst)/)
  })
})
