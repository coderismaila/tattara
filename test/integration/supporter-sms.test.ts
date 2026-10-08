// Task 5.2 against Postgres: thank-you SMS after sync, delivery reports verifying numbers, STOP opting a number out
// (hashed, audited without the number), the hourly anonymisation clearing records and their SMS, and opt_out_spike.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, flags, puStats, smsOptOuts, smsQueue, supporters, users } from '../../server/db/schema'
import { applyDeliveryReport, handleStop, isOptedOut, phoneHash, queueThankYous, runAnonymisation, type SupporterSmsConfig } from '../../server/services/supporter-sms'
import { createSupporter, requestRemoval } from '../../server/services/supporters'
import { seedDev } from '../../scripts/seed/run'
import type { SessionUser } from '../../shared/types/auth'
import type { SupporterInput } from '../../shared/types/supporter'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const PU = '19/01/01/001'
const CONFIG: SupporterSmsConfig = { phoneHashSecret: 'integration-phone-hash-secret-32-chars!!', orgName: 'Test Party', replyNumber: '+2348099990000' }
let phoneSeq = 0
const nextPhone = () => `+23480398${String(10000 + phoneSeq++).slice(-5)}`

describe.skipIf(!dbAvailable)('supporter SMS: thank-you, delivery, STOP, anonymisation', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  let lead: SessionUser

  const asCaller = async (phone: string): Promise<SessionUser> => {
    const [u] = await db.select().from(users).where(eq(users.phone, phone))
    return { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
  }
  const add = async (caller: SessionUser, over: Partial<SupporterInput> = {}) => {
    const now = new Date().toISOString()
    const r = await createSupporter(db, caller, {
      id: newId(), puCode: caller.unitCode!, fullName: 'Sms Test', phone: nextPhone(), sharedPhone: false, address: 'Near the mosque',
      gender: null, ageBand: null, supportLevel: 'strong', hasPvc: 'yes', volunteer: false, consentAt: now, consentVersion: 'c1-ha',
      consentLanguage: 'ha', gps: { lat: 12, lng: 8.5, accuracyM: 10 }, capturedAt: now, deviceId: 'device-sms-test', ...over,
    })
    if (r.kind !== 'accepted') throw new Error(r.kind)
    return r.supporter
  }
  const sms = (phone: string) => db.select().from(smsQueue).where(eq(smsQueue.toPhone, phone))
  const stats = async () => (await db.select().from(puStats).where(eq(puStats.puCode, PU)))[0]!
  /** What processSmsQueue does when the provider accepts the message. */
  const markSent = (id: string, ref: string) => db.update(smsQueue).set({ status: 'sent', providerRef: ref, sentAt: sql`now()`, nextAttemptAt: null }).where(eq(smsQueue.id, id))

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    lead = await asCaller('+2348000000104')
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('thank-you', () => {
    it('is queued in the consent language, once per number per day, linked to the supporter', async () => {
      const phone = nextPhone()
      const first = await add(lead, { phone, consentLanguage: 'en', consentVersion: 'c1-en' })
      const second = await add(lead, { phone, sharedPhone: true })
      expect(await queueThankYous(db, [first.id], CONFIG)).toBe(1)
      expect(await queueThankYous(db, [second.id], CONFIG)).toBe(0) // same household number, same day
      const rows = await sms(phone)
      expect(rows).toEqual([expect.objectContaining({ purpose: 'thank_you', supporterId: first.id, scopeCode: PU, status: 'queued' })])
      expect(rows[0]!.body).toBe('Test Party: thank you for your support. To be removed, reply STOP to +2348099990000.')
      expect(rows[0]!.body).not.toContain('Sms Test') // never the supporter's name
    })

    it('is never sent to a number that opted out', async () => {
      const phone = nextPhone()
      await db.insert(smsOptOuts).values({ phoneHash: phoneHash(phone, CONFIG.phoneHashSecret) })
      const s = await add(lead, { phone })
      expect(await queueThankYous(db, [s.id], CONFIG)).toBe(0)
      expect(await sms(phone)).toEqual([])
    })
  })

  describe('delivery reports', () => {
    it('a delivered thank-you verifies every unverified record on the number; pu_stats follows', async () => {
      const phone = nextPhone()
      const a = await add(lead, { phone })
      const b = await add(lead, { phone, sharedPhone: true })
      await queueThankYous(db, [a.id], CONFIG)
      const [msg] = await sms(phone)
      await markSent(msg!.id, 'ref-delivered')
      const before = await stats()

      expect(await applyDeliveryReport(db, 'ref-delivered', 'delivered')).toBe(true)
      const rows = await db.select().from(supporters).where(inArray(supporters.id, [a.id, b.id]))
      expect(rows.map(r => r.verification)).toEqual(['sms_delivered', 'sms_delivered'])
      expect((await stats()).verified).toBe(before.verified + 2)
      expect((await sms(phone))[0]!.status).toBe('delivered')

      // Repeated or late reports change nothing.
      expect(await applyDeliveryReport(db, 'ref-delivered', 'failed')).toBe(false)
      expect(await applyDeliveryReport(db, 'no-such-ref', 'delivered')).toBe(false)
    })

    it('a failed one leaves the supporter unverified', async () => {
      const s = await add(lead)
      await queueThankYous(db, [s.id], CONFIG)
      const [msg] = await sms(s.phone!)
      await markSent(msg!.id, 'ref-failed')
      expect(await applyDeliveryReport(db, 'ref-failed', 'failed')).toBe(true)
      const [row] = await db.select().from(supporters).where(eq(supporters.id, s.id))
      expect(row!.verification).toBe('unverified')
    })
  })

  describe('STOP and anonymisation', () => {
    it('STOP opts out every live record on the number, stores only a hash, audits by id, confirms once', async () => {
      const phone = nextPhone()
      const a = await add(lead, { phone })
      const b = await add(lead, { phone, sharedPhone: true, consentLanguage: 'en', consentVersion: 'c1-en' })
      const before = await stats()

      const result = await handleStop(db, phone, CONFIG)
      expect(result).toEqual({ optedOut: 2, confirmationQueued: true })
      const rows = await db.select().from(supporters).where(inArray(supporters.id, [a.id, b.id]))
      for (const r of rows) {
        expect(r).toMatchObject({ verification: 'opted_out', status: 'removal_requested' })
        expect(r.optedOutAt).toBeInstanceOf(Date)
      }
      expect((await stats()).optedOut).toBe(before.optedOut + 2)
      expect(await isOptedOut(db, phone, CONFIG.phoneHashSecret)).toBe(true)
      const stored = await db.select().from(smsOptOuts)
      expect(JSON.stringify(stored)).not.toContain(phone.slice(4))

      const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'supporter.opt_out'))
      expect(audits.map(x => x.targetId).sort()).toEqual([a.id, b.id].sort())
      expect(JSON.stringify(audits)).not.toContain(phone.slice(4))

      // Answered in the language of the latest record on the number.
      const confirm = (await sms(phone)).filter(m => m.purpose === 'opt_out_confirm')
      expect(confirm.map(m => m.body)).toEqual(['Test Party: you have been removed. You will get no more messages from us.'])
      expect(await handleStop(db, phone, CONFIG)).toEqual({ optedOut: 0, confirmationQueued: false })
    })

    it('a STOP from an unknown number still blocks it', async () => {
      const phone = nextPhone()
      expect(await handleStop(db, phone, CONFIG)).toMatchObject({ optedOut: 0 })
      expect(await isOptedOut(db, phone, CONFIG.phoneHashSecret)).toBe(true)
    })

    it('the hourly job anonymises every removal request and deletes finished SMS to those numbers', async () => {
      const phone = nextPhone()
      const s = await add(lead, { phone })
      await queueThankYous(db, [s.id], CONFIG)
      const [thanks] = await sms(phone)
      await markSent(thanks!.id, 'ref-anon')
      await handleStop(db, phone, CONFIG)
      // The confirmation is still queued: it must survive this run and go out.
      const byLead = await add(lead)
      expect((await requestRemoval(db, lead, byLead.id, 'Asked in person')).kind).toBe('ok')

      const first = await runAnonymisation(db)
      expect(first.anonymised).toBeGreaterThanOrEqual(2)
      const rows = await db.select().from(supporters).where(inArray(supporters.id, [s.id, byLead.id]))
      for (const r of rows) {
        expect(r).toMatchObject({ status: 'anonymised', fullName: '—', phone: null, address: null, gps: null })
      }
      expect((await sms(phone)).map(m => m.purpose)).toEqual(['opt_out_confirm']) // queued one kept

      // Once sent, the next run removes it too.
      const [confirm] = await sms(phone)
      await markSent(confirm!.id, 'ref-confirm')
      expect((await runAnonymisation(db)).smsDeleted).toBeGreaterThanOrEqual(1)
      expect(await sms(phone)).toEqual([])
      expect(await runAnonymisation(db)).toEqual({ anonymised: 0, smsDeleted: 0 })

      const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'supporter.anonymise')).limit(1)
      expect(audit!.meta).toMatchObject({ anonymised: expect.any(Number) })
    })
  })

  describe('opt_out_spike', () => {
    it('flags a lead when ≥ 5 recent opt-outs are ≥ 10% of their supporters', async () => {
      // A fresh PU lead with 10 supporters (the seeded leads hold thousands).
      const [u] = await db.insert(users).values({
        fullName: 'Spike Lead', phone: '+2348000000777', role: 'PU_LEAD', unitCode: '19/01/01/003', unitLevel: 'pu',
        pinHash: 'x', status: 'active',
      }).returning()
      const spikeLead: SessionUser = { id: u!.id, role: 'PU_LEAD', unitCode: '19/01/01/003', sessionVersion: 0 }
      const mine = []
      for (let i = 0; i < 10; i++) mine.push(await add(spikeLead))

      for (const s of mine.slice(0, 4)) await handleStop(db, s.phone!, CONFIG)
      const spike = () => db.select().from(flags).where(and(eq(flags.type, 'opt_out_spike'), eq(flags.userId, u!.id)))
      expect(await spike()).toEqual([])
      await handleStop(db, mine[4]!.phone!, CONFIG)
      const [flag] = await spike()
      expect(flag).toMatchObject({ puCode: '19/01/01/003', supporterId: null, status: 'open' })
      expect(flag!.details).toMatchObject({ optOuts: 5, supporters: 10, days: 7 })
    })
  })
})
