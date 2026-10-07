// Task 4.2: local-first capture. Saves are atomic and idempotent, server results update the local records, network
// failures keep everything queued, and the offline duplicate count stays within the PU.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupporterInput, SyncItemResult } from '../../shared/types/supporter'
import { newId } from '../../shared/utils/uuid'
import { db, setMeta, wipeDevice } from '../../app/offline/db'
import { applyResults, countLocalPhone, discardCapture, listOutbox, pendingCount, saveCapture } from '../../app/offline/outbox'
import { PUSH_BATCH_SIZE, pushOutbox } from '../../app/offline/push'

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
const ok = (id: string): SyncItemResult => ({ id, result: 'accepted', serverUpdatedAt: '2026-10-07T09:01:00.000Z' })

beforeEach(async () => {
  await wipeDevice()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saveCapture', () => {
  it('writes the supporter as pending and queues it, in one go', async () => {
    const item = capture()
    await saveCapture(item)
    expect(await db.supporters.get(item.id)).toMatchObject({ id: item.id, syncStatus: 'pending' })
    expect(await listOutbox()).toEqual([expect.objectContaining({ id: item.id, kind: 'create', payload: item, attempts: 0 })])
  })

  it('is idempotent by id', async () => {
    const item = capture()
    await saveCapture(item)
    await saveCapture(item)
    expect(await pendingCount()).toBe(1)
  })

  it('writes nothing if the transaction fails', async () => {
    const item = capture()
    const add = vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('quota'))
    await expect(saveCapture(item)).rejects.toThrow('quota')
    add.mockRestore()
    expect(await db.supporters.get(item.id)).toBeUndefined()
    expect(await pendingCount()).toBe(0)
  })

  it('discardCapture removes both the record and its queue entry', async () => {
    const item = capture()
    await saveCapture(item)
    await discardCapture(item.id)
    expect(await db.supporters.count()).toBe(0)
    expect(await pendingCount()).toBe(0)
  })
})

describe('applyResults', () => {
  it('marks accepted and duplicate synced, rejected and conflict rejected, and dequeues all of them', async () => {
    const [a, b, c, d, e] = Array.from({ length: 5 }, () => capture())
    for (const item of [a, b, c, d, e]) await saveCapture(item!)
    await applyResults([
      ok(a!.id),
      { id: b!.id, result: 'duplicate', serverUpdatedAt: '2026-10-07T09:01:00.000Z' },
      { id: c!.id, result: 'rejected', reason: 'phone_limit' },
      { id: d!.id, result: 'conflict' },
    ])
    expect(await db.supporters.get(a!.id)).toMatchObject({ syncStatus: 'synced', serverUpdatedAt: '2026-10-07T09:01:00.000Z' })
    expect(await db.supporters.get(b!.id)).toMatchObject({ syncStatus: 'synced' })
    expect(await db.supporters.get(c!.id)).toMatchObject({ syncStatus: 'rejected', rejectReason: 'phone_limit' })
    expect(await db.supporters.get(d!.id)).toMatchObject({ syncStatus: 'rejected', rejectReason: 'conflict' })
    expect((await listOutbox()).map(r => r.id)).toEqual([e!.id]) // unanswered: still queued
  })

  it('keeps rows the server could not tie to an id', async () => {
    const item = capture()
    await saveCapture(item)
    await applyResults([{ id: null, result: 'rejected', reason: 'invalid' }])
    expect(await pendingCount()).toBe(1)
  })
})

describe('pushOutbox', () => {
  it('sends the oldest batch and applies the answers', async () => {
    const items = Array.from({ length: PUSH_BATCH_SIZE + 2 }, () => capture())
    for (const item of items) await saveCapture(item)
    const fetch = vi.fn(async (_url: string, opts: { body: { items: SupporterInput[] } }) => ({ results: opts.body.items.map(i => ok(i.id)) }))
    vi.stubGlobal('$fetch', fetch)

    const outcome = await pushOutbox()
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]![1].body.items.map(i => i.id)).toEqual(items.slice(0, PUSH_BATCH_SIZE).map(i => i.id))
    expect(outcome).toMatchObject({ sent: true })
    expect(await pendingCount()).toBe(2)
  })

  it('keeps everything queued and counts the attempt when the server is unreachable', async () => {
    const item = capture()
    await saveCapture(item)
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { statusCode: undefined })))
    expect(await pushOutbox()).toEqual({ sent: false, statusCode: null })
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { statusCode: 429 })))
    expect(await pushOutbox()).toEqual({ sent: false, statusCode: 429 })
    expect(await listOutbox()).toEqual([expect.objectContaining({ id: item.id, attempts: 2 })])
    expect(await db.supporters.get(item.id)).toMatchObject({ syncStatus: 'pending' })
  })

  it('does not call the server with an empty queue', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    expect(await pushOutbox()).toEqual({ sent: true, results: [], lastSeq: null })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('countLocalPhone', () => {
  it('counts this PU only, and not captures the server refused', async () => {
    const phone = '+2348031007777'
    const mine = capture({ phone })
    const refused = capture({ phone })
    await saveCapture(mine)
    await saveCapture(refused)
    await saveCapture(capture({ phone, puCode: '19/01/01/002' }))
    await applyResults([{ id: refused.id, result: 'rejected', reason: 'phone_limit' }])
    expect(await countLocalPhone(PU, phone)).toBe(1)
    expect(await countLocalPhone(PU, '+2348031000000')).toBe(0)
  })
})

describe('wipeDevice', () => {
  it('empties the 4.2 tables too', async () => {
    await saveCapture(capture())
    await db.units.put({ code: PU, parentCode: '19/01/01', name: 'Kofar Gida', level: 'pu' })
    await setMeta('session', { userId: 'x' })
    await wipeDevice()
    expect([await db.supporters.count(), await db.outbox.count(), await db.units.count(), await db.meta.count()]).toEqual([0, 0, 0, 0])
  })
})
