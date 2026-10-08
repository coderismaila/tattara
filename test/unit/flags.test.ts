// Task 5.1: the GPS distance limit, and that the engine is wired to the sync, the phone edit and the nightly task.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GPS_FLAG_METERS, GPS_FAR_ESTIMATED_METERS, gpsFarThreshold } from '../../shared/constants/flags'

const ROOT = join(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

describe('gpsFarThreshold', () => {
  it('uses the configured distance for a real PU location', () => {
    expect(gpsFarThreshold(3000, false)).toBe(3000)
    expect(gpsFarThreshold(1500, false)).toBe(1500)
  })

  it('widens it for an estimated location, never narrows it', () => {
    expect(gpsFarThreshold(3000, true)).toBe(GPS_FAR_ESTIMATED_METERS)
    expect(gpsFarThreshold(20_000, true)).toBe(20_000)
  })

  it('falls back to the default for a missing or nonsensical setting', () => {
    expect(gpsFarThreshold(0, false)).toBe(DEFAULT_GPS_FLAG_METERS)
    expect(gpsFarThreshold(Number.NaN, false)).toBe(DEFAULT_GPS_FLAG_METERS)
  })
})

describe('wiring', () => {
  it('sync push and phone edits run the checks without failing the save; the scan runs nightly', () => {
    expect(read('server/api/sync/push.post.ts')).toMatch(/flagAfterWrite\(/)
    expect(read('server/api/supporters/[id].patch.ts')).toMatch(/changed\.includes\('phone'\)[\s\S]*flagAfterWrite\(/)
    expect(read('nuxt.config.ts')).toMatch(/'0 1 \* \* \*': \['flags:scan'\]/)
    expect(read('server/tasks/flags/scan.ts')).toMatch(/name: 'flags:scan'/)
  })
})
