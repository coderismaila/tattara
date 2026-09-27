// Task 3.6: every route × every caller, from the matrix. One test per route; each caller gets a fresh request
// context with their saved session, so a logout or a revoked session in one case can't leak into another.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { E2E_PORT } from '../support/env'
import { ACCESS_FIXTURE_FILE, CALLERS, callerStateFile } from './callers'
import { ACCESS_MATRIX, FORBIDDEN_RESPONSE_KEYS, type AccessEntry, type AccessFixture } from './matrix'

const BASE_URL = `http://localhost:${E2E_PORT}`

/** Every key anywhere in a JSON value. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)])
  return []
}

// Denied callers first, then the allowed ones: mutating routes change their target only on success.
const ordered = (entry: AccessEntry) => [...CALLERS].sort((a, b) => Number(entry.expect[a] < 300) - Number(entry.expect[b] < 300))

for (const [route, entry] of Object.entries(ACCESS_MATRIX) as [string, AccessEntry][]) {
  test(route, async ({ playwright }) => {
    const fixture = JSON.parse(readFileSync(ACCESS_FIXTURE_FILE, 'utf8')) as AccessFixture
    const failures: string[] = []

    for (const caller of ordered(entry)) {
      const api = await playwright.request.newContext({
        baseURL: BASE_URL,
        storageState: caller === 'anon' ? undefined : callerStateFile(caller),
      })
      try {
        const req = entry.request(fixture, caller)
        const res = await api.fetch(req.path, {
          method: req.method,
          headers: req.method === 'GET' ? {} : { Origin: BASE_URL },
          data: req.body,
        })
        const status = res.status()
        if (status !== entry.expect[caller]) {
          failures.push(`${caller}: expected ${entry.expect[caller]}, got ${status} ${await res.text().catch(() => '')}`.slice(0, 300))
          continue
        }
        const body = res.headers()['content-type']?.includes('json') ? await res.json() : null
        const leaked = allKeys(body).filter(k => FORBIDDEN_RESPONSE_KEYS.includes(k))
        if (leaked.length) failures.push(`${caller}: response leaks ${leaked.join(', ')}`)
        if (status < 300 && entry.check) {
          try {
            entry.check(caller, body)
          }
          catch (error) {
            failures.push(`${caller}: ${(error as Error).message}`)
          }
        }
      }
      finally {
        await api.dispose()
      }
    }
    expect(failures, route).toEqual([])
  })
}
