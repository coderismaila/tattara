import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { APP_SHELL_URL, PRECACHE_IGNORES, isApiRequest, isAppNavigation, isGeoRequest, swPost } from '../../service-worker/routes'

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

describe('swPost (Background Sync, 4.3)', () => {
  it('posts the batch with the session cookie and returns the results', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [{ id: 'a', result: 'accepted' }] }), { status: 200 }))
    expect(await swPost([{ id: 'a' }], fetcher as unknown as typeof fetch)).toEqual({ results: [{ id: 'a', result: 'accepted' }] })
    expect(fetcher).toHaveBeenCalledWith('/api/sync/push', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: '{"items":[{"id":"a"}]}' }))
  })

  it('throws with the status like $fetch, so the engine keeps the rows and backs off', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429 }))
    await expect(swPost([], fetcher as unknown as typeof fetch)).rejects.toMatchObject({ statusCode: 429 })
  })
})
