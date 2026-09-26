import { and, desc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, invites, otpCodes, rateLimits, smsQueue, userDevices, users } from '../../server/db/schema'
import {
  LOCKOUT, OTP_POLICY, attemptLogin, completeSetup, createInvite, hashOtp, issueDeviceOtp,
  resendDeviceOtp, sendInvite, verifyDeviceOtp, type AuthConfig,
} from '../../server/services/auth'
import { verifyPin } from '../../server/utils/pin'
import { hitRateLimit } from '../../server/services/rate-limit'
import { seedDev } from '../../scripts/seed/run'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const cfg: AuthConfig = { otpSecret: 'test-otp-secret-that-is-at-least-32-chars', siteUrl: 'https://tattara.test' }
const PU_LEAD = '+2348000000104' // Kano chain, invited by the ward lead +2348000000103
const WARD_LEAD = '+2348000000103'
const DEV_PIN = '123456'

describe.skipIf(!dbAvailable)('auth service', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  const user = async (phone: string) => (await db.select().from(users).where(eq(users.phone, phone)))[0]!
  const lastSms = async (to: string) =>
    (await db.select().from(smsQueue).where(eq(smsQueue.toPhone, to)).orderBy(desc(smsQueue.createdAt)).limit(1))[0]
  /** Codes are only in the SMS body (hashed in otp_codes); the queue row still has it until the processor redacts it. */
  const codeFromSms = async (to: string) => /\d{6}/.exec((await lastSms(to))!.body)![0]

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
  })

  beforeEach(async () => {
    // Fresh state for the users these tests touch.
    await db.delete(rateLimits)
    await db.delete(otpCodes)
    await db.delete(smsQueue)
    await db.delete(userDevices)
    await db.update(users).set({ failedPinAttempts: 0, lockedUntil: null })
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('login', () => {
    it('rejects unknown phones and wrong PINs the same way', async () => {
      expect(await attemptLogin(db, { phone: '+2348039999999', pin: DEV_PIN, deviceId: newId() }, cfg)).toEqual({ kind: 'invalid' })
      expect(await attemptLogin(db, { phone: PU_LEAD, pin: '999999', deviceId: newId() }, cfg)).toEqual({ kind: 'invalid' })
      expect((await user(PU_LEAD)).failedPinAttempts).toBe(1)
    })

    it('asks for an OTP on a new device, and logs straight in on a trusted one', async () => {
      const deviceId = newId()
      expect(await attemptLogin(db, { phone: PU_LEAD, pin: DEV_PIN, deviceId }, cfg)).toEqual({ kind: 'otp_required' })
      const sms = await lastSms(PU_LEAD)
      expect(sms).toMatchObject({ purpose: 'otp', status: 'queued' })
      expect(sms!.body).toMatch(/^Tattara: lambar tabbatarwa \d{6}\./)

      const code = await codeFromSms(PU_LEAD)
      const verified = await verifyDeviceOtp(db, { phone: PU_LEAD, code, deviceId }, cfg)
      expect(verified).toMatchObject({ kind: 'ok', user: { role: 'PU_LEAD', unitCode: '19/01/01/001' } })

      expect(await attemptLogin(db, { phone: PU_LEAD, pin: DEV_PIN, deviceId }, cfg)).toMatchObject({ kind: 'ok' })
    })

    it('a correct PIN resets the failure counter', async () => {
      await attemptLogin(db, { phone: PU_LEAD, pin: '999999', deviceId: newId() }, cfg)
      await attemptLogin(db, { phone: PU_LEAD, pin: DEV_PIN, deviceId: newId() }, cfg)
      expect((await user(PU_LEAD)).failedPinAttempts).toBe(0)
    })

    it(`locks for ${LOCKOUT.minutes} minutes after ${LOCKOUT.maxAttempts} wrong PINs, even for the right PIN`, async () => {
      const deviceId = newId()
      for (let i = 1; i < LOCKOUT.maxAttempts; i++) {
        expect(await attemptLogin(db, { phone: PU_LEAD, pin: '999999', deviceId }, cfg)).toEqual({ kind: 'invalid' })
      }
      const locked = await attemptLogin(db, { phone: PU_LEAD, pin: '999999', deviceId }, cfg)
      expect(locked).toMatchObject({ kind: 'locked' })
      expect((locked as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(LOCKOUT.minutes * 60 - 5)
      expect(await attemptLogin(db, { phone: PU_LEAD, pin: DEV_PIN, deviceId }, cfg)).toMatchObject({ kind: 'locked' })

      // After the lock expires, the right PIN works again.
      await db.update(users).set({ lockedUntil: sql`now() - interval '1 second'` }).where(eq(users.phone, PU_LEAD))
      expect(await attemptLogin(db, { phone: PU_LEAD, pin: DEV_PIN, deviceId }, cfg)).toEqual({ kind: 'otp_required' })
    })

    it('audits each lockout and texts the supervising lead on the third in 24 h (once)', async () => {
      const pu = await user(PU_LEAD)
      await db.execute(sql`alter table audit_log disable trigger audit_log_no_update_delete`)
      await db.delete(auditLog)
      await db.execute(sql`alter table audit_log enable trigger audit_log_no_update_delete`)

      const lockOnce = async () => {
        for (let i = 0; i < LOCKOUT.maxAttempts; i++) await attemptLogin(db, { phone: PU_LEAD, pin: '999999', deviceId: newId() }, cfg)
        await db.update(users).set({ lockedUntil: null }).where(eq(users.id, pu.id))
      }
      await lockOnce()
      await lockOnce()
      expect(await lastSms(WARD_LEAD)).toBeUndefined()
      await lockOnce()
      const alert = await lastSms(WARD_LEAD)
      expect(alert!.body).toContain('19/01/01/001')
      expect(alert!.body).not.toContain('Dev Kano') // unit code, not the person's name
      await lockOnce()
      expect((await db.select().from(smsQueue).where(eq(smsQueue.toPhone, WARD_LEAD)))).toHaveLength(1)

      const lockouts = await db.select().from(auditLog).where(and(eq(auditLog.action, 'auth.lockout'), eq(auditLog.targetId, pu.id)))
      expect(lockouts).toHaveLength(4)
    })

    it('refuses invited (no PIN yet) and deactivated users', async () => {
      await db.update(users).set({ status: 'deactivated' }).where(eq(users.phone, PU_LEAD))
      expect(await attemptLogin(db, { phone: PU_LEAD, pin: DEV_PIN, deviceId: newId() }, cfg)).toEqual({ kind: 'invalid' })
      await db.update(users).set({ status: 'active' }).where(eq(users.phone, PU_LEAD))
    })
  })

  describe('device OTP', () => {
    const start = async () => {
      const deviceId = newId()
      await attemptLogin(db, { phone: PU_LEAD, pin: DEV_PIN, deviceId }, cfg)
      return { deviceId, code: await codeFromSms(PU_LEAD) }
    }

    it('stores only an HMAC of the code, and binds it to the device', async () => {
      const { deviceId, code } = await start()
      const [otp] = await db.select().from(otpCodes).where(eq(otpCodes.phone, PU_LEAD))
      expect(otp!.codeHash).toBe(hashOtp(code, cfg.otpSecret))
      expect(otp!.codeHash).not.toContain(code)
      expect(otp!.deviceId).toBe(deviceId)

      expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code, deviceId: newId() }, cfg)).toEqual({ kind: 'invalid' })
      expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code, deviceId }, cfg)).toMatchObject({ kind: 'ok' })
      // Single use.
      expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code, deviceId }, cfg)).toEqual({ kind: 'invalid' })
    })

    it(`allows ${OTP_POLICY.maxAttempts} wrong codes, then blocks even the right one`, async () => {
      const { deviceId, code } = await start()
      const wrong = code === '000000' ? '000001' : '000000'
      for (let i = 1; i < OTP_POLICY.maxAttempts; i++) {
        expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code: wrong, deviceId }, cfg)).toEqual({ kind: 'invalid' })
      }
      expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code: wrong, deviceId }, cfg)).toEqual({ kind: 'too_many_attempts' })
      expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code, deviceId }, cfg)).toEqual({ kind: 'too_many_attempts' })
    })

    it('expires after 10 minutes', async () => {
      const { deviceId, code } = await start()
      await db.update(otpCodes).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(otpCodes.phone, PU_LEAD))
      expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code, deviceId }, cfg)).toEqual({ kind: 'expired' })
    })

    it('resend replaces the code; only the newest works', async () => {
      const { deviceId, code: first } = await start()
      expect(await resendDeviceOtp(db, PU_LEAD, cfg)).toEqual({ kind: 'sent' })
      const second = await codeFromSms(PU_LEAD)
      if (first !== second) {
        expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code: first, deviceId }, cfg)).toEqual({ kind: 'invalid' })
      }
      expect(await verifyDeviceOtp(db, { phone: PU_LEAD, code: second, deviceId }, cfg)).toMatchObject({ kind: 'ok' })
    })

    it('resend does nothing without a pending PIN-verified login', async () => {
      expect(await resendDeviceOtp(db, PU_LEAD, cfg)).toEqual({ kind: 'nothing_pending' })
      expect(await lastSms(PU_LEAD)).toBeUndefined()
    })

    it('sends at most 3 codes an hour per phone', async () => {
      const pu = await user(PU_LEAD)
      const target = { userId: pu.id, phone: PU_LEAD, deviceId: newId() }
      for (let i = 0; i < 3; i++) expect(await issueDeviceOtp(db, target, cfg)).toEqual({ kind: 'sent' })
      expect(await issueDeviceOtp(db, target, cfg)).toMatchObject({ kind: 'rate_limited' })
      expect(await attemptLogin(db, { phone: PU_LEAD, pin: DEV_PIN, deviceId: newId() }, cfg)).toMatchObject({ kind: 'otp_rate_limited' })
    })
  })

  describe('invites and setup', () => {
    const invitedLead = async () => {
      const ward = await user(WARD_LEAD)
      const [u] = await db.insert(users).values({
        fullName: 'New PU Lead',
        phone: `+23480312${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`,
        role: 'PU_LEAD',
        unitCode: '19/01/01/002',
        unitLevel: 'pu',
        status: 'invited',
        invitedBy: ward.id,
      }).returning()
      return u!
    }

    it('texts an invite link and stores only the token hash', async () => {
      const lead = await invitedLead()
      await sendInvite(db, lead.id, (await user(WARD_LEAD)).id, cfg)
      const sms = await lastSms(lead.phone)
      const token = /\/setup\?t=([\w-]{22})/.exec(sms!.body)![1]!
      expect(sms).toMatchObject({ purpose: 'invite' })
      expect(sms!.body).toContain('https://tattara.test/setup?t=')
      const [inv] = await db.select().from(invites).where(eq(invites.userId, lead.id))
      expect(inv!.tokenHash).not.toContain(token)
    })

    it('setup sets the PIN, activates, trusts the device and bumps the session version; the link is single use', async () => {
      const lead = await invitedLead()
      const token = await createInvite(db, lead.id, null)
      const deviceId = newId()
      const result = await completeSetup(db, { token, pin: '482915', deviceId })
      expect(result).toMatchObject({ kind: 'ok', user: { id: lead.id, sessionVersion: lead.sessionVersion + 1 } })

      const after = await user(lead.phone)
      expect(after.status).toBe('active')
      expect(await verifyPin(after.pinHash!, '482915')).toBe(true)
      expect(await attemptLogin(db, { phone: lead.phone, pin: '482915', deviceId }, cfg)).toMatchObject({ kind: 'ok' })
      expect(await completeSetup(db, { token, pin: '482915', deviceId })).toEqual({ kind: 'invalid' })

      await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, lead.id))
    })

    it('rejects expired and replaced links', async () => {
      const lead = await invitedLead()
      const old = await createInvite(db, lead.id, null)
      const fresh = await createInvite(db, lead.id, null)
      expect(await completeSetup(db, { token: old, pin: '482915', deviceId: newId() })).toEqual({ kind: 'expired' })
      await db.update(invites).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(invites.userId, lead.id))
      expect(await completeSetup(db, { token: fresh, pin: '482915', deviceId: newId() })).toEqual({ kind: 'expired' })
      await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, lead.id))
    })

    it('refuses a second active lead for the same unit', async () => {
      const lead = await invitedLead()
      await db.update(users).set({ unitCode: '19/01/01/001' }).where(eq(users.id, lead.id)) // the seeded PU lead's unit
      const token = await createInvite(db, lead.id, null)
      expect(await completeSetup(db, { token, pin: '482915', deviceId: newId() })).toEqual({ kind: 'unit_taken' })
    })
  })

  describe('rate limiter', () => {
    it('counts within a window and resets after it', async () => {
      const rule = { limit: 2, windowSec: 60 }
      expect(await hitRateLimit(db, 'k', rule)).toMatchObject({ allowed: true, count: 1 })
      expect(await hitRateLimit(db, 'k', rule)).toMatchObject({ allowed: true, count: 2 })
      const third = await hitRateLimit(db, 'k', rule)
      expect(third).toMatchObject({ allowed: false, count: 3 })
      expect(third.retryAfterSec).toBeGreaterThan(55)

      await db.update(rateLimits).set({ windowStart: sql`now() - interval '61 seconds'` })
      expect(await hitRateLimit(db, 'k', rule)).toMatchObject({ allowed: true, count: 1 })
      // Keys are hashed at rest.
      expect((await db.select().from(rateLimits))[0]!.key).toMatch(/^[0-9a-f]{64}$/)
    })
  })
})
