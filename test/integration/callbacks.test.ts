// Task 5.3 against Postgres: the daily call-back sample (5% per ward, rounded up; only live, reachable supporters;
// never twice; missed days caught up; reruns add nothing), outcomes updating verification, pu_stats and flags, scope,
// and the pass rate.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, callbacks, flags, puStats, supporters, users } from '../../server/db/schema'
import { completeCallback, listCallbacks, sampleCallbacks, sampleSize } from '../../server/services/callbacks'
import { createSupporter } from '../../server/services/supporters'
import { seedDev } from '../../scripts/seed/run'
import type { SessionUser } from '../../shared/types/auth'
import { addDays, lagosDate } from '../../shared/utils/lagos-date'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const PU = '19/01/01/001'
const WARD = '19/01/01'
let phoneSeq = 0
const nextPhone = () => `+23480397${String(10000 + phoneSeq++).slice(-5)}`

describe.skipIf(!dbAvailable)('call-backs', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const who: Record<string, SessionUser> = {}
  const today = lagosDate()

  const asCaller = async (phone: string): Promise<SessionUser> => {
    const [u] = await db.select().from(users).where(eq(users.phone, phone))
    return { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
  }
  /** `n` supporters on the Kano PU lead's PU, received on Lagos day `day` (noon). */
  const addOn = async (day: string, n: number) => {
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const now = new Date().toISOString()
      const r = await createSupporter(db, who.pu!, {
        id: newId(), puCode: PU, fullName: 'Call Me', phone: nextPhone(), sharedPhone: false, address: null, gender: null,
        ageBand: null, supportLevel: 'strong', hasPvc: 'yes', volunteer: false, consentAt: now, consentVersion: 'c1-ha',
        consentLanguage: 'ha', gps: null, capturedAt: now, deviceId: 'device-callback-test',
      })
      if (r.kind !== 'accepted') throw new Error(r.kind)
      ids.push(r.supporter.id)
    }
    await db.update(supporters).set({ createdAt: sql`(${day}::date + time '12:00')::timestamp at time zone 'Africa/Lagos'` })
      .where(inArray(supporters.id, ids))
    return ids
  }
  const callsFor = (ids: string[]) => db.select().from(callbacks).where(inArray(callbacks.supporterId, ids))

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' }) // the seed's supporters were all received today: never sampled here
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    who.ward = await asCaller('+2348000000103')
    who.pu = await asCaller('+2348000000104')
    who.lga = await asCaller('+2348000000102')
    who.otherWard = await asCaller('+2348000000203')
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('sampleSize: 5%, rounded up', () => {
    expect([0, 1, 19, 20, 21, 100].map(n => sampleSize(n))).toEqual([0, 1, 1, 1, 2, 5])
  })

  describe('daily sample', () => {
    it('takes 5% (rounded up) of yesterday\'s new supporters per ward, due today, assigned to the ward lead', async () => {
      const yesterday = addDays(today, -1)
      const ids = await addOn(yesterday, 30)
      expect(await sampleCallbacks(db, today)).toBe(2)
      const calls = await callsFor(ids)
      expect(calls).toHaveLength(2)
      expect(calls.every(c => c.wardCode === WARD && c.dueDate === today && c.assignedTo === who.ward!.id && c.outcome === null)).toBe(true)
    })

    it('a rerun adds nothing, and a ward already sampled for a day is not topped up', async () => {
      expect(await sampleCallbacks(db, today)).toBe(0)
      await addOn(addDays(today, -1), 5) // late arrivals for a day already sampled
      expect(await sampleCallbacks(db, today)).toBe(0)
    })

    it('catches up days a run missed (within a week), not older ones', async () => {
      const recent = await addOn(addDays(today, -3), 4)
      const old = await addOn(addDays(today, -9), 4)
      expect(await sampleCallbacks(db, today)).toBe(1)
      expect(await callsFor(recent)).toEqual([expect.objectContaining({ dueDate: addDays(today, -2) })])
      expect(await callsFor(old)).toEqual([])
    })

    it('skips opted-out, removal-requested and anonymised supporters', async () => {
      const day = addDays(today, -4)
      const ids = await addOn(day, 3)
      await db.update(supporters).set({ verification: 'opted_out' }).where(eq(supporters.id, ids[0]!))
      await db.update(supporters).set({ status: 'removal_requested' }).where(eq(supporters.id, ids[1]!))
      await db.update(supporters).set({ status: 'anonymised', phone: null, address: null, gps: null, fullName: '—' }).where(eq(supporters.id, ids[2]!))
      expect(await sampleCallbacks(db, today)).toBe(0)
    })
  })

  describe('the ward lead\'s list and outcomes', () => {
    it('lists today\'s calls with name and phone; only ward leads, only their ward', async () => {
      const r = await listCallbacks(db, who.ward!, today)
      if (r.kind !== 'ok') throw new Error(r.kind)
      expect(r.items.length).toBeGreaterThanOrEqual(3) // 2 due today + 1 overdue from the catch-up
      expect(r.items[0]!.overdue).toBe(true) // oldest first
      expect(r.items.every(i => i.supporter.puCode.startsWith(`${WARD}/`) && /^\+234/.test(i.supporter.phone))).toBe(true)

      const other = await listCallbacks(db, who.otherWard!, today)
      expect(other.kind === 'ok' && other.items).toEqual([])
      for (const caller of [who.pu!, who.lga!]) expect(await listCallbacks(db, caller, today)).toEqual({ kind: 'forbidden' })
    })

    it('verified: callback_verified, pu_stats.verified +1, audited without notes', async () => {
      const r = await listCallbacks(db, who.ward!, today)
      if (r.kind !== 'ok') throw new Error(r.kind)
      const call = r.items.find(i => !i.outcome)!
      const before = (await db.select().from(puStats).where(eq(puStats.puCode, PU)))[0]!

      const done = await completeCallback(db, who.ward!, call.id, { outcome: 'verified', notes: 'Confirmed, very keen' })
      expect(done).toMatchObject({ kind: 'ok', item: { outcome: 'verified', verification: 'callback_verified' } })
      const after = (await db.select().from(puStats).where(eq(puStats.puCode, PU)))[0]!
      expect(after.verified).toBe(before.verified + 1)
      const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'callback.complete'), eq(auditLog.targetId, call.supporter.id)))
      expect(audit!.meta).toEqual({ callbackId: call.id, outcome: 'verified' })

      expect(await completeCallback(db, who.ward!, call.id, { outcome: 'denies' })).toEqual({ kind: 'already_done' })
    })

    it('wrong number / denies: callback_failed and a callback_failed flag; unreachable changes nothing', async () => {
      const r = await listCallbacks(db, who.ward!, today)
      if (r.kind !== 'ok') throw new Error(r.kind)
      const [wrong, unreachable] = r.items.filter(i => !i.outcome)
      expect(await completeCallback(db, who.ward!, wrong!.id, { outcome: 'wrong_number' })).toMatchObject({ item: { verification: 'callback_failed' } })
      const [flag] = await db.select().from(flags).where(and(eq(flags.supporterId, wrong!.supporter.id), eq(flags.type, 'callback_failed')))
      expect(flag).toMatchObject({ status: 'open', puCode: PU, details: { outcome: 'wrong_number' } })

      expect(await completeCallback(db, who.ward!, unreachable!.id, { outcome: 'unreachable' })).toMatchObject({ item: { verification: 'unverified' } })
    })

    it('another ward\'s lead finds nothing; other roles are refused', async () => {
      const [call] = await db.select().from(callbacks).where(eq(callbacks.wardCode, WARD)).limit(1)
      expect(await completeCallback(db, who.otherWard!, call!.id, { outcome: 'verified' })).toEqual({ kind: 'not_found' })
      expect(await completeCallback(db, who.pu!, call!.id, { outcome: 'verified' })).toEqual({ kind: 'forbidden' })
    })

    it('the pass rate counts answered calls over 30 days', async () => {
      const r = await listCallbacks(db, who.ward!, today)
      if (r.kind !== 'ok') throw new Error(r.kind)
      expect(r.passRate).toEqual({ days: 30, verified: 1, failed: 1, unreachable: 1, rate: 0.5 })
    })
  })
})
