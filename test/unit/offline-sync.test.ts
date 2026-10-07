// Task 4.3: the sync engine. Backoff, batching (each row once per run), the pull (captures waiting for the server are
// never overwritten, tombstones remove, pages follow the cursor, `lastPullAt` only moves after the last page), and one
// run at a time (Web Lock + coalescing).
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PUSH_BACKOFF_BASE_MS, PUSH_BACKOFF_MAX_MS } from '../../shared/constants/sync'
import type { SupporterDto, SupporterInput, SyncItemResult } from '../../shared/types/supporter'
import type { PullResponse } from '../../shared/types/sync'
import { newId } from '../../shared/utils/uuid'
import { db, getMeta, setMeta, wipeDevice } from '../../app/offline/db'
import { backoffMs, listOutbox, markAttempted, pendingCount, saveCapture } from '../../app/offline/outbox'
import { PullSessionGone, applyPull, getLastPullAt, getPullStats, pullAll, type PullGet } from '../../app/offline/pull'
import type { PushPost } from '../../app/offline/push'
import { runSync, syncNow } from '../../app/offline/sync'

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
const dto = (over: Partial<SupporterDto> = {}): SupporterDto => ({
  masked: false,
  id: newId(),
  puCode: PU,
  fullName: 'Musa Bello',
  phone: '+2348031003001',
  sharedPhone: false,
  address: null,
  gender: 'male',
  ageBand: null,
  supportLevel: 'leaning',
  hasPvc: 'yes',
  volunteer: false,
  consentAt: '2026-10-06T09:00:00.000Z',
  consentVersion: 'c1-ha',
  consentLanguage: 'ha',
  gps: null,
  capturedAt: '2026-10-06T09:00:05.000Z',
  capturedBy: newId(),
  verification: 'unverified',
  status: 'active',
  createdAt: '2026-10-06T09:01:00.000Z',
  updatedAt: '2026-10-06T09:01:00.000Z',
  ...over,
})
const page = (over: Partial<PullResponse> = {}): PullResponse => ({
  supporters: [],
  units: [],
  stats: { total: 0, verified: 0, flaggedOpen: 0, lastCaptureAt: null },
  announcements: [],
  serverTime: '2026-10-07T10:00:00.000Z',
  nextCursor: null,
  ...over,
})
const accept: PushPost = async items => ({
  results: items.map(i => ({ id: i.id, result: 'accepted', serverUpdatedAt: '2026-10-07T09:01:00.000Z' }) as SyncItemResult),
})
const emptyPull: PullGet = async () => page()

async function signedIn(role = 'PU_LEAD', unitCode: string | null = PU) {
  await setMeta('session', { userId: 'u1', fullName: 'Lead', role, unitCode, unit: null, savedAt: '2026-10-07T08:00:00.000Z' })
}

beforeEach(async () => {
  await wipeDevice()
})

describe('backoffMs', () => {
  it('doubles from 30 s, capped at 30 min, in the upper half of the window', () => {
    expect(backoffMs(1, () => 1)).toBe(PUSH_BACKOFF_BASE_MS)
    expect(backoffMs(1, () => 0)).toBe(PUSH_BACKOFF_BASE_MS / 2)
    expect(backoffMs(3, () => 1)).toBe(PUSH_BACKOFF_BASE_MS * 4)
    expect(backoffMs(30, () => 1)).toBe(PUSH_BACKOFF_MAX_MS)
    expect(backoffMs(30, () => 0)).toBe(PUSH_BACKOFF_MAX_MS / 2)
  })

  it('markAttempted pushes nextAttemptAt into the future', async () => {
    await saveCapture(capture())
    const [row] = await listOutbox()
    const now = Date.parse('2026-10-07T09:00:00.000Z')
    await markAttempted([row!.seq!], now)
    const [after] = await listOutbox()
    expect(after!.attempts).toBe(1)
    expect(Date.parse(after!.nextAttemptAt) - now).toBeGreaterThanOrEqual(PUSH_BACKOFF_BASE_MS / 2)
  })
})

describe('runSync: push', () => {
  it('sends every queued capture in batches of ≤ 50, each exactly once, then pulls', async () => {
    await signedIn()
    const items = Array.from({ length: 120 }, () => capture())
    for (const item of items) await saveCapture(item)
    const post = vi.fn(accept)
    const get = vi.fn(emptyPull)

    const report = await runSync({ post, get })
    expect(post.mock.calls.map(c => c[0].length)).toEqual([50, 50, 20])
    expect(post.mock.calls.flatMap(c => c[0].map(i => i.id))).toEqual(items.map(i => i.id))
    expect(report.results).toHaveLength(120)
    expect(report.pulled).toBe(true)
    expect(await pendingCount()).toBe(0)
  })

  it('never sends a row twice in one run, even if the server left it unanswered', async () => {
    await signedIn()
    await saveCapture(capture())
    const post = vi.fn<PushPost>(async () => ({ results: [{ id: null, result: 'rejected', reason: 'invalid' }] }))
    await runSync({ force: true, post, get: emptyPull })
    expect(post).toHaveBeenCalledOnce()
    expect(await pendingCount()).toBe(1)
  })

  it('skips backed-off rows unless forced', async () => {
    await signedIn()
    await saveCapture(capture())
    const [row] = await listOutbox()
    await markAttempted([row!.seq!])
    const post = vi.fn(accept)
    await runSync({ post, get: emptyPull })
    expect(post).not.toHaveBeenCalled()
    await runSync({ force: true, post, get: emptyPull })
    expect(post).toHaveBeenCalledOnce()
    expect(await pendingCount()).toBe(0)
  })

  it('stops on an unanswered push and keeps the rows; signed out (401) also skips the pull', async () => {
    await signedIn()
    await saveCapture(capture())
    const get = vi.fn(emptyPull)
    const down = vi.fn<PushPost>().mockRejectedValue(Object.assign(new Error('down'), { statusCode: 503 }))
    expect(await runSync({ post: down, get })).toMatchObject({ pushError: 503, pulled: true })
    expect(down).toHaveBeenCalledOnce()

    const gone = vi.fn<PushPost>().mockRejectedValue(Object.assign(new Error('401'), { statusCode: 401 }))
    get.mockClear()
    expect(await runSync({ force: true, post: gone, get })).toMatchObject({ pushError: 401, pulled: false })
    expect(get).not.toHaveBeenCalled()
    expect(await listOutbox()).toEqual([expect.objectContaining({ attempts: 2 })])
  })

  it('does nothing without a local session', async () => {
    const post = vi.fn(accept)
    expect(await runSync({ post, get: emptyPull })).toMatchObject({ skipped: true })
    expect(post).not.toHaveBeenCalled()
  })

  it('only PU and ward leads pull', async () => {
    await signedIn('LGA_LEAD', '19/01')
    const get = vi.fn(emptyPull)
    expect(await runSync({ post: accept, get })).toMatchObject({ pulled: false })
    expect(get).not.toHaveBeenCalled()
  })
})

describe('one run at a time', () => {
  it('two runs started together (two tabs, or a tab and the service worker) never push at the same time', async () => {
    await signedIn()
    for (let i = 0; i < 3; i++) await saveCapture(capture())
    let inFlight = 0
    let maxInFlight = 0
    const post: PushPost = async (items) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await new Promise(r => setTimeout(r, 20))
      inFlight--
      return accept(items)
    }
    const [a, b] = await Promise.all([runSync({ post, get: emptyPull }), runSync({ post, get: emptyPull })])
    expect(maxInFlight).toBe(1)
    expect(a.results.length + b.results.length).toBe(3) // each capture sent once
  })

  it('syncNow runs once more after the run in progress, and calls meanwhile share that run', async () => {
    await signedIn()
    await saveCapture(capture())
    const post = vi.fn(accept)
    const first = syncNow({ post, get: emptyPull })
    const late = capture()
    await saveCapture(late) // saved after the first run may have read the outbox
    const second = syncNow({ post, get: emptyPull, force: true })
    const third = syncNow({ post, get: emptyPull })
    expect(third).toBe(second)
    const reports = await Promise.all([first, second])
    expect(reports.flatMap(r => r.results).map(r => r.id)).toContain(late.id)
    expect(await pendingCount()).toBe(0)
  })
})

describe('pull', () => {
  beforeEach(async () => {
    await signedIn()
  })

  it('a phone wiped (or taken over by another lead) while a page was on its way stays wiped', async () => {
    const get: PullGet = async () => {
      await wipeDevice() // revoked: the session plugin wipes the phone mid-request
      return page({ supporters: [dto()], units: [{ code: PU, parentCode: '19/01/01', name: 'Kofar Gida', level: 'pu', active: true }] })
    }
    expect(await runSync({ post: accept, get })).toMatchObject({ skipped: true, pulled: false })
    expect([await db.supporters.count(), await db.units.count(), await db.meta.count()]).toEqual([0, 0, 0])

    await signedIn()
    await setMeta('session', { userId: 'someone-else' })
    await expect(applyPull(page({ supporters: [dto()] }), 'u1')).rejects.toBeInstanceOf(PullSessionGone)
    expect(await db.supporters.count()).toBe(0)
  })

  it('applies a page: fresh records in, captures still queued or refused kept, tombstones removed', async () => {
    const queued = capture()
    const refused = capture()
    await saveCapture(queued)
    await saveCapture(refused)
    await db.supporters.update(refused.id, { syncStatus: 'rejected', rejectReason: 'phone_limit' })
    await db.outbox.where('id').equals(refused.id).delete()
    const gone = dto()
    await db.supporters.put({ ...capture({ id: gone.id }), deviceId: undefined, syncStatus: 'synced' })
    const fresh = dto({ fullName: 'Fresh Record' })

    await applyPull(page({
      supporters: [
        fresh,
        dto({ id: queued.id, fullName: 'Server Copy' }),
        dto({ id: refused.id, fullName: 'Server Copy' }),
        { id: gone.id, deleted: true },
      ],
      units: [{ code: PU, parentCode: '19/01/01', name: 'Kofar Gida', level: 'pu', active: true }],
      stats: { total: 7, verified: 1, flaggedOpen: 0, lastCaptureAt: null },
    }), 'u1')

    expect(await db.supporters.get(fresh.id)).toMatchObject({ fullName: 'Fresh Record', syncStatus: 'synced', serverUpdatedAt: fresh.updatedAt })
    expect(await db.supporters.get(queued.id)).toMatchObject({ fullName: 'Hauwa Sani', syncStatus: 'pending' })
    expect(await db.supporters.get(refused.id)).toMatchObject({ fullName: 'Hauwa Sani', syncStatus: 'rejected' })
    expect(await db.supporters.get(gone.id)).toBeUndefined()
    expect(await db.units.toArray()).toHaveLength(1)
    expect(await getPullStats()).toMatchObject({ total: 7 })

    // Later pages carry no units: the stored ones stay.
    await applyPull(page(), 'u1')
    expect(await db.units.count()).toBe(1)
  })

  it('follows the cursor with the same since, and moves lastPullAt only after the last page', async () => {
    await setMeta('pullUnit', PU)
    await setMeta('lastPullAt', '2026-10-07T08:00:00.000Z')
    const get = vi.fn<PullGet>()
      .mockResolvedValueOnce(page({ supporters: [dto()], nextCursor: '1_x', serverTime: '2026-10-07T10:00:00.000Z' }))
      .mockResolvedValueOnce(page({ supporters: [dto()], serverTime: '2026-10-07T10:00:05.000Z' }))
    await pullAll('u1', PU, get)
    expect(get.mock.calls.map(c => c[0])).toEqual([
      { since: '2026-10-07T08:00:00.000Z', cursor: undefined },
      { since: '2026-10-07T08:00:00.000Z', cursor: '1_x' },
    ])
    expect(await getLastPullAt()).toBe('2026-10-07T10:00:00.000Z') // the first page's time: nothing in between is missed
    expect(await db.supporters.count()).toBe(2)

    const broken = vi.fn<PullGet>()
      .mockResolvedValueOnce(page({ nextCursor: '1_y', serverTime: '2026-10-07T11:00:00.000Z' }))
      .mockRejectedValueOnce(Object.assign(new Error('down'), { statusCode: 503 }))
    await expect(pullAll('u1', PU, broken)).rejects.toThrow('down')
    expect(await getLastPullAt()).toBe('2026-10-07T10:00:00.000Z')
  })

  it('a lead moved to another unit starts over and loses the old unit\'s synced records', async () => {
    const OTHER = '19/01/01/002'
    await setMeta('pullUnit', PU)
    await setMeta('lastPullAt', '2026-10-07T08:00:00.000Z')
    const old = dto()
    await db.supporters.put({ ...capture({ id: old.id }), deviceId: undefined, syncStatus: 'synced' })
    const unsent = capture()
    await saveCapture(unsent) // still owed to the server: kept
    const get = vi.fn(emptyPull)
    await pullAll('u1', OTHER, get)
    expect(get).toHaveBeenCalledWith({ since: undefined, cursor: undefined })
    expect(await db.supporters.get(old.id)).toBeUndefined()
    expect(await db.supporters.get(unsent.id)).toBeDefined()
    expect(await getMeta('pullUnit')).toBe(OTHER)
  })
})
