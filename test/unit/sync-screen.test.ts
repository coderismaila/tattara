// Task 4.4: what the Sync screen and the status pill show. Groups of this phone's captures (pulled records left out),
// removing only refused ones, the last-sent time, and the pill's wording for each state.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupporterInput } from '../../shared/types/supporter'
import { newId } from '../../shared/utils/uuid'
import { db, setMeta, wipeDevice } from '../../app/offline/db'
import { applyResults, captureCounts, getRejected, listLocalCaptures, markAttempted, listOutbox, removeRejected, saveCapture } from '../../app/offline/outbox'
import { getLastSyncAt, runSync } from '../../app/offline/sync'
import { syncPillView } from '../../app/utils/sync-pill'

const PU = '19/01/01/001'
const capture = (over: Partial<SupporterInput> = {}): SupporterInput => ({
  id: newId(),
  puCode: PU,
  fullName: 'Hauwa Sani',
  phone: '+2348031002001',
  sharedPhone: false,
  address: null,
  gender: null,
  ageBand: null,
  supportLevel: 'strong',
  hasPvc: 'yes',
  volunteer: false,
  consentAt: '2026-10-07T09:00:00.000Z',
  consentVersion: 'c1-ha',
  consentLanguage: 'ha',
  gps: null,
  capturedAt: '2026-10-07T09:00:05.000Z',
  deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
  ...over,
})
const at = (minute: number) => `2026-10-07T09:${String(minute).padStart(2, '0')}:00.000Z`

beforeEach(async () => {
  await wipeDevice()
})

describe('listLocalCaptures', () => {
  it('groups this phone\'s captures: refused and sent newest first, waiting oldest first with tries', async () => {
    const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(m => capture({ capturedAt: at(m), fullName: `P${m}` }))
    for (const item of [a, b, c, d, e]) await saveCapture(item!)
    await applyResults([
      { id: a!.id, result: 'accepted', serverUpdatedAt: at(10) },
      { id: b!.id, result: 'accepted', serverUpdatedAt: at(10) },
      { id: c!.id, result: 'rejected', reason: 'phone_limit' },
    ])
    const [first] = await listOutbox()
    await markAttempted([first!.seq!])
    // A record brought by the pull (no deviceId) is not one of this phone's captures.
    await db.supporters.put({ ...capture({ capturedAt: at(6) }), deviceId: undefined, syncStatus: 'synced' })

    const groups = await listLocalCaptures()
    expect(groups.rejected.map(s => s.fullName)).toEqual(['P3'])
    expect(groups.pending.map(s => [s.fullName, s.attempts])).toEqual([['P4', 1], ['P5', 0]])
    expect(groups.sent.map(s => s.fullName)).toEqual(['P2', 'P1'])
    expect(groups.sentTotal).toBe(2)
    expect(await captureCounts()).toEqual({ pending: 2, rejected: 1 })
  })

  it('lists at most `sentLimit` sent captures but counts them all', async () => {
    const items = [1, 2, 3].map(m => capture({ capturedAt: at(m) }))
    for (const item of items) await saveCapture(item)
    await applyResults(items.map(i => ({ id: i.id, result: 'accepted' as const, serverUpdatedAt: at(10) })))
    const groups = await listLocalCaptures(2)
    expect(groups.sent).toHaveLength(2)
    expect(groups.sentTotal).toBe(3)
  })
})

describe('removeRejected / getRejected', () => {
  it('only acts on refused captures', async () => {
    const refused = capture()
    const waiting = capture()
    await saveCapture(refused)
    await saveCapture(waiting)
    await applyResults([{ id: refused.id, result: 'conflict' }])

    expect(await getRejected(waiting.id)).toBeUndefined()
    expect(await getRejected(refused.id)).toMatchObject({ rejectReason: 'conflict' })
    expect(await removeRejected(waiting.id)).toBe(false)
    expect(await db.supporters.get(waiting.id)).toBeDefined()
    expect(await removeRejected(refused.id)).toBe(true)
    expect(await db.supporters.get(refused.id)).toBeUndefined()
    expect((await listOutbox()).map(r => r.id)).toEqual([waiting.id])
  })
})

describe('last sent time', () => {
  it('is saved when the server answered, not when it did not', async () => {
    await setMeta('session', { userId: 'u1', fullName: 'Lead', role: 'PU_LEAD', unitCode: PU, unit: null, savedAt: at(0) })
    await saveCapture(capture())
    await runSync({ post: async () => Promise.reject(Object.assign(new Error('down'), { statusCode: 503 })), pull: false })
    expect(await getLastSyncAt()).toBeUndefined()
    await runSync({ force: true, post: async items => ({ results: items.map(i => ({ id: i.id, result: 'accepted' as const, serverUpdatedAt: at(10) })) }), pull: false })
    expect(await getLastSyncAt()).toEqual(expect.any(String))
  })
})

describe('syncPillView', () => {
  const base = { online: true, running: false, pending: 0, rejected: 0 }
  it.each([
    [{ ...base }, { key: 'allSent', tone: 'success' }],
    [{ ...base, pending: 3 }, { key: 'waiting', count: 3, tone: 'neutral' }],
    [{ ...base, pending: 3, running: true }, { key: 'sending', count: 3 }],
    [{ ...base, running: true }, { key: 'allSent' }],
    [{ ...base, online: false, pending: 12 }, { key: 'offline', count: 12, tone: 'neutral' }],
    [{ ...base, online: false }, { key: 'offline', count: 0 }],
    [{ ...base, online: false, pending: 2, rejected: 1 }, { key: 'rejected', count: 1, tone: 'warning' }],
  ])('%o → %o', (input, expected) => {
    expect(syncPillView(input)).toMatchObject(expected)
  })

  it('is never red: offline is a normal state', () => {
    for (const online of [true, false]) {
      for (const pending of [0, 5]) {
        for (const rejected of [0, 2]) {
          expect(['neutral', 'success', 'warning']).toContain(syncPillView({ online, running: false, pending, rejected }).tone)
        }
      }
    }
  })
})
