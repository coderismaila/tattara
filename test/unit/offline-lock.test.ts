// Task 4.5: offline PIN verifier, idle timing, and the local session (save, unlock attempts, wipe).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getMeta, wipeDevice } from '../../app/offline/db'
import { isIdleExpired, LAST_ACTIVE_STORAGE_KEY } from '../../app/offline/idle'
import type { MeResponse } from '../../app/offline/local-session'
import { createPinVerifier, PIN_VERIFIER_ITERATIONS, verifyPin } from '../../app/offline/pin-verifier'

// Keep the tests fast: the real iteration count only changes the cost, not the logic.
vi.mock('../../app/offline/pin-verifier', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../app/offline/pin-verifier')>()
  return { ...real, createPinVerifier: (pin: string) => real.createPinVerifier(pin, 1_000) }
})

const { canUnlockOffline, getLocalSession, MAX_UNLOCK_FAILURES, refreshLocalSession, startLocalSession, unlockWithPin }
  = await import('../../app/offline/local-session')

const me = (id = '0190f3a2-1c4b-7d8e-9f0a-1b2c3d4e5f60', fullName = 'Amina Bello'): MeResponse => ({
  user: { id, fullName, role: 'PU_LEAD', unitCode: '19/01/01/001' },
  unit: { code: '19/01/01/001', name: 'Kofar Gida', level: 'pu' },
})

describe('pin verifier', () => {
  it('accepts the PIN it was made from and nothing else', async () => {
    const verifier = await createPinVerifier('482915')
    expect(await verifyPin('482915', verifier)).toBe(true)
    expect(await verifyPin('482916', verifier)).toBe(false)
    expect(await verifyPin('', verifier)).toBe(false)
  })

  it('never stores the PIN, and salts each verifier', async () => {
    const a = await createPinVerifier('482915')
    const b = await createPinVerifier('482915')
    expect(JSON.stringify(a)).not.toContain('482915')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it('records the iteration count it used; the default is at least OWASP 2023 for PBKDF2-SHA256', async () => {
    expect(PIN_VERIFIER_ITERATIONS).toBeGreaterThanOrEqual(600_000)
    const real = await vi.importActual<typeof import('../../app/offline/pin-verifier')>('../../app/offline/pin-verifier')
    const verifier = await real.createPinVerifier('482915', 2_000)
    expect(verifier).toMatchObject({ v: 1, iterations: 2_000 })
    expect(await verifyPin('482915', { ...verifier, iterations: 2_001 })).toBe(false)
  })
})

describe('isIdleExpired', () => {
  const idle = 5 * 60_000
  const now = 1_800_000_000_000

  it.each([
    ['no recorded activity', null, true],
    ['not a number', Number.NaN, true],
    ['active a minute ago', now - 60_000, false],
    ['just under the limit', now - idle + 1, false],
    ['exactly the limit', now - idle, true],
    ['long ago', now - 24 * 3_600_000, true],
    ['in the future (clock moved back)', now + 1_000, true],
  ])('%s → %s', (_label, last, expired) => {
    expect(isIdleExpired(last, now, idle)).toBe(expired)
  })
})

describe('local session', () => {
  beforeEach(async () => {
    await wipeDevice()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cannot unlock before a sign-in', async () => {
    expect(await canUnlockOffline()).toBe(false)
  })

  it('saves the lead and a verifier at sign-in, and unlocks with the same PIN', async () => {
    await startLocalSession(me(), '482915')
    expect(await getLocalSession()).toMatchObject({ userId: me().user.id, fullName: 'Amina Bello', unitCode: '19/01/01/001' })
    expect(await canUnlockOffline()).toBe(true)
    expect(await unlockWithPin('482915')).toEqual({ ok: true })
  })

  it('counts wrong PINs across calls and wipes the phone on the last allowed one', async () => {
    await startLocalSession(me(), '482915')
    for (let left = MAX_UNLOCK_FAILURES - 1; left > 0; left--) {
      expect(await unlockWithPin('000000')).toEqual({ ok: false, wiped: false, remaining: left })
    }
    expect(await unlockWithPin('000000')).toEqual({ ok: false, wiped: true })
    expect(await getLocalSession()).toBeUndefined()
    expect(await canUnlockOffline()).toBe(false)
  })

  it('a right PIN resets the count', async () => {
    await startLocalSession(me(), '482915')
    await unlockWithPin('000000')
    await unlockWithPin('000000')
    await unlockWithPin('482915')
    expect(await getMeta('unlockFailures')).toBe(0)
    expect(await unlockWithPin('000000')).toMatchObject({ remaining: MAX_UNLOCK_FAILURES - 1 })
  })

  it('wipes the previous lead\'s data when a different lead signs in on the phone', async () => {
    await startLocalSession(me(), '482915')
    await db.meta.put({ key: 'other', value: 'left by the previous lead' })
    await startLocalSession(me('0190f3a2-1c4b-7d8e-9f0a-1b2c3d4e5f61', 'Sani Musa'), '193746')
    expect(await getMeta('other')).toBeUndefined()
    expect((await getLocalSession())?.fullName).toBe('Sani Musa')
  })

  it('keeps data when the same lead signs in again', async () => {
    await startLocalSession(me(), '482915')
    await db.meta.put({ key: 'other', value: 'kept' })
    await startLocalSession(me(), '482915')
    expect(await getMeta('other')).toBe('kept')
  })

  it('refreshes the snapshot only for the same lead', async () => {
    await startLocalSession(me(), '482915')
    await refreshLocalSession(me(undefined, 'Amina B. Bello'))
    expect((await getLocalSession())?.fullName).toBe('Amina B. Bello')
    await refreshLocalSession(me('0190f3a2-1c4b-7d8e-9f0a-1b2c3d4e5f61', 'Someone Else'))
    expect((await getLocalSession())?.fullName).toBe('Amina B. Bello')
  })

  it('wipeDevice empties the database and forgets the last activity time', async () => {
    const store = new Map<string, string>([[LAST_ACTIVE_STORAGE_KEY, '1']])
    vi.stubGlobal('localStorage', { removeItem: (k: string) => store.delete(k) })
    await startLocalSession(me(), '482915')
    await wipeDevice()
    expect(await db.meta.count()).toBe(0)
    expect(store.has(LAST_ACTIVE_STORAGE_KEY)).toBe(false)
  })
})
