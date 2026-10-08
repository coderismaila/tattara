// Task 6.2: the trend-line path, the progress ring, and the PU home's offline "added today" count (Lagos day).
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupporterInput } from '../../shared/types/supporter'
import { newId } from '../../shared/utils/uuid'
import { ringDash, ringFraction, trendPath } from '../../app/utils/charts'
import { db, wipeDevice } from '../../app/offline/db'
import { countCapturedToday, lagosDayStart } from '../../app/offline/home'
import { saveCapture } from '../../app/offline/outbox'

describe('trendPath', () => {
  it('is empty without points and a flat line for one', () => {
    expect(trendPath([], 100, 40)).toBe('')
    expect(trendPath([{ day: '2026-10-01', value: 5 }], 100, 40)).toBe('M2 20 L98 20')
  })

  it('spans the box: first point left, last right, lowest value at the bottom', () => {
    const d = trendPath([{ day: 'a', value: 10 }, { day: 'b', value: 30 }, { day: 'c', value: 20 }], 100, 40)
    expect(d).toBe('M2 38 L50 2 L98 20')
  })

  it('draws equal values mid-height', () => {
    expect(trendPath([{ day: 'a', value: 7 }, { day: 'b', value: 7 }], 100, 40)).toBe('M2 20 L98 20')
  })
})

describe('progress ring', () => {
  it('fraction of the target, clamped; none without a target', () => {
    expect(ringFraction(50, 200)).toBe(0.25)
    expect(ringFraction(300, 200)).toBe(1)
    expect(ringFraction(-3, 200)).toBe(0)
    expect(ringFraction(50, null)).toBeNull()
    expect(ringFraction(50, 0)).toBeNull()
  })

  it('dash array is the filled arc then the whole circumference', () => {
    expect(ringDash(0.5, 10)).toBe(`${Math.round(Math.PI * 1000) / 100} ${Math.round(2 * Math.PI * 1000) / 100}`)
  })
})

describe('added today (offline)', () => {
  const PU = '19/01/01/001'
  const capture = (capturedAt: string, over: Partial<SupporterInput> = {}): SupporterInput => ({
    id: newId(), puCode: PU, fullName: 'Today Test', phone: '+2348031002001', sharedPhone: false, address: null, gender: null,
    ageBand: null, supportLevel: 'strong', hasPvc: 'yes', volunteer: false, consentAt: capturedAt, consentVersion: 'c1-ha',
    consentLanguage: 'ha', gps: null, capturedAt, deviceId: 'device-today', ...over,
  })

  beforeEach(async () => {
    await wipeDevice()
  })

  it('a Lagos day starts at 23:00 UTC the evening before', () => {
    expect(lagosDayStart(new Date('2026-10-08T10:00:00Z'))).toBe('2026-10-07T23:00:00.000Z')
    expect(lagosDayStart(new Date('2026-10-07T23:30:00Z'))).toBe('2026-10-07T23:00:00.000Z')
  })

  it('counts this PU\'s captures since the start of the Lagos day, not refused ones', async () => {
    const now = new Date('2026-10-08T10:00:00Z')
    await saveCapture(capture('2026-10-07T22:59:00.000Z')) // yesterday in Lagos
    await saveCapture(capture('2026-10-07T23:05:00.000Z'))
    await saveCapture(capture('2026-10-08T09:00:00.000Z'))
    await saveCapture(capture('2026-10-08T09:30:00.000Z', { puCode: '19/01/01/002' }))
    const refused = capture('2026-10-08T09:40:00.000Z')
    await saveCapture(refused)
    await db.supporters.update(refused.id, { syncStatus: 'rejected' })
    expect(await countCapturedToday(PU, now)).toBe(2)
  })
})
