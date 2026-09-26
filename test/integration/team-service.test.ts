import { and, desc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, smsQueue, userDevices, users } from '../../server/db/schema'
import { AuditPiiError } from '../../server/services/audit'
import type { AuthConfig } from '../../server/services/auth'
import { deactivateLead, inviteLead, listTeam, resetLeadPin } from '../../server/services/team'
import { seedDev } from '../../scripts/seed/run'
import type { SessionUser } from '../../shared/types/auth'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const cfg: AuthConfig = { otpSecret: 'test-otp-secret-that-is-at-least-32-chars', siteUrl: 'https://tattara.test' }
let phoneSeq = 0
const newPhone = () => `+23480355${String(++phoneSeq).padStart(5, '0')}`

describe.skipIf(!dbAvailable)('team service', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const who: Record<string, SessionUser> = {}

  const byPhone = async (phone: string) => (await db.select().from(users).where(eq(users.phone, phone)))[0]!
  const asCaller = async (phone: string): Promise<SessionUser> => {
    const u = await byPhone(phone)
    return { id: u.id, role: u.role, unitCode: u.unitCode, sessionVersion: u.sessionVersion }
  }

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    who.admin = await asCaller('+2348000000001')
    who.dg = await asCaller('+2348000000002')
    who.kanoState = await asCaller('+2348000000101')
    who.kanoLga = await asCaller('+2348000000102')
    who.kanoWard = await asCaller('+2348000000103') // 19/01/01
    who.kanoPu = await asCaller('+2348000000104') // 19/01/01/001
    who.katsinaWard = await asCaller('+2348000000203') // 20/01/01
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('listTeam', () => {
    it('lists the direct child units with their leads', async () => {
      const r = await listTeam(db, who.kanoWard!)
      if (r.kind !== 'ok') throw new Error(r.kind)
      expect(r.unit).toMatchObject({ code: '19/01/01', level: 'ward' })
      expect(r.canManage).toBe(true)
      expect(r.members).toHaveLength(10)
      expect(r.members[0]).toMatchObject({
        code: '19/01/01/001',
        level: 'pu',
        qualityScore: null,
        lead: { fullName: 'Dev Kano PU Lead', status: 'active', phone: '+2348000000104' },
      })
      expect(r.members[1]!.lead).toBeNull()
    })

    it('DG sees the states; deeper units in scope are listed with masked phones and no management', async () => {
      const dg = await listTeam(db, who.dg!)
      if (dg.kind !== 'ok') throw new Error(dg.kind)
      expect(dg.unit.level).toBe('region')
      expect(dg.members.map(m => m.code)).toEqual(['19', '20'])

      const deeper = await listTeam(db, who.kanoState!, '19/01/01')
      if (deeper.kind !== 'ok') throw new Error(deeper.kind)
      expect(deeper.canManage).toBe(false)
      expect(deeper.members[0]!.lead!.phone).toBe('+234 80* *** 0104')
    })

    it('forbids PU leads, ADMIN, units outside scope and PU-level units', async () => {
      expect(await listTeam(db, who.kanoPu!)).toEqual({ kind: 'forbidden' })
      expect(await listTeam(db, who.admin!)).toEqual({ kind: 'forbidden' })
      expect(await listTeam(db, who.kanoWard!, '20/01/01')).toEqual({ kind: 'forbidden' })
      expect(await listTeam(db, who.kanoLga!, '19/01/01/001')).toEqual({ kind: 'forbidden' })
    })
  })

  describe('inviteLead', () => {
    it('invites into a direct child unit: invited user, SMS link, audit without PII', async () => {
      const phone = newPhone()
      const r = await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/002', fullName: 'Aisha Bello', phone }, cfg)
      expect(r).toMatchObject({ kind: 'ok', replacedUserId: null })
      const invited = await byPhone(phone)
      expect(invited).toMatchObject({ role: 'PU_LEAD', unitCode: '19/01/01/002', status: 'invited', pinHash: null, invitedBy: who.kanoWard!.id })

      const [sms] = await db.select().from(smsQueue).where(eq(smsQueue.toPhone, phone))
      expect(sms).toMatchObject({ purpose: 'invite' })
      expect(sms!.body).toContain('https://tattara.test/setup?t=')

      const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'user.invite'), eq(auditLog.targetId, invited.id)))
      expect(entry).toMatchObject({ actorId: who.kanoWard!.id, scopeCode: '19/01/01/002', meta: { role: 'PU_LEAD', replaced: false } })
      expect(JSON.stringify(entry!.meta)).not.toContain('Aisha')
    })

    it.each([
      ['a ward lead into another ward', 'kanoWard', '20/01/01/005'],
      ['a ward lead into a sibling ward\'s PU', 'kanoWard', '19/01/02/001'],
      ['an LGA lead two levels down', 'kanoLga', '19/01/01/003'],
      ['a lead into their own unit', 'kanoWard', '19/01/01'],
      ['a PU lead', 'kanoPu', '19/01/01/004'],
      ['ADMIN (DG invites are task 2.6)', 'admin', '19'],
      ['a unit that does not exist', 'kanoWard', '19/01/01/999'],
    ])('forbids %s', async (_label, caller, unitCode) => {
      expect(await inviteLead(db, who[caller]!, { unitCode, fullName: 'X Y', phone: newPhone() }, cfg)).toEqual({ kind: 'forbidden' })
    })

    it('DG invites state leads', async () => {
      // Katsina already has an active state lead from the seed: replace is required.
      expect(await inviteLead(db, who.dg!, { unitCode: '20', fullName: 'New State Lead', phone: newPhone() }, cfg)).toEqual({ kind: 'unit_has_active_lead' })
    })

    it('replacing deactivates the current lead in the same step (R-1)', async () => {
      const oldPhone = newPhone()
      await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/003', fullName: 'Old Lead', phone: oldPhone }, cfg)
      await db.update(users).set({ status: 'active', pinHash: 'x' }).where(eq(users.phone, oldPhone))
      const old = await byPhone(oldPhone)

      expect(await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/003', fullName: 'New Lead', phone: newPhone() }, cfg)).toEqual({ kind: 'unit_has_active_lead' })
      const replaced = await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/003', fullName: 'New Lead', phone: newPhone(), replace: true }, cfg)
      expect(replaced).toMatchObject({ kind: 'ok', replacedUserId: old.id })
      expect(await byPhone(oldPhone)).toMatchObject({ status: 'deactivated', sessionVersion: old.sessionVersion + 1 })
    })

    it('one pending invite per unit: a new invite supersedes; re-inviting the same person resends', async () => {
      const first = newPhone()
      await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/004', fullName: 'First', phone: first }, cfg)
      expect(await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/004', fullName: 'First', phone: first }, cfg)).toMatchObject({ kind: 'ok' })
      expect((await byPhone(first)).status).toBe('invited')
      expect(await db.select().from(smsQueue).where(eq(smsQueue.toPhone, first))).toHaveLength(2)

      const second = newPhone()
      await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/004', fullName: 'Second', phone: second }, cfg)
      expect((await byPhone(first)).status).toBe('deactivated')
      expect((await byPhone(second)).status).toBe('invited')
    })

    it('refuses a phone that belongs to an active lead elsewhere, and the same active lead again', async () => {
      expect(await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/005', fullName: 'X Y', phone: '+2348000000203' }, cfg)).toEqual({ kind: 'phone_in_use' })
      expect(await inviteLead(db, who.kanoWard!, { unitCode: '19/01/01/001', fullName: 'Dev', phone: '+2348000000104', replace: true }, cfg)).toEqual({ kind: 'already_active' })
    })
  })

  describe('deactivateLead / resetLeadPin', () => {
    const activeChild = async (unitCode: string) => {
      const phone = newPhone()
      await inviteLead(db, who.kanoWard!, { unitCode, fullName: 'Child Lead', phone }, cfg)
      await db.update(users).set({ status: 'active', pinHash: 'x' }).where(eq(users.phone, phone))
      const u = await byPhone(phone)
      await db.insert(userDevices).values({ userId: u.id, deviceId: `dev-${phone}` })
      return u
    }

    it('deactivates: status, session version, devices revoked, audited with the reason', async () => {
      const child = await activeChild('19/01/01/006')
      expect(await deactivateLead(db, who.kanoWard!, child.id, 'left the group')).toEqual({ kind: 'ok' })
      const after = await byPhone(child.phone)
      expect(after).toMatchObject({ status: 'deactivated', sessionVersion: child.sessionVersion + 1 })
      const [device] = await db.select().from(userDevices).where(eq(userDevices.userId, child.id))
      expect(device!.revokedAt).toBeInstanceOf(Date)
      const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'user.deactivate'), eq(auditLog.targetId, child.id))).orderBy(desc(auditLog.at))
      expect(entry).toMatchObject({ actorId: who.kanoWard!.id, meta: { reason: 'left the group' } })

      expect(await deactivateLead(db, who.kanoWard!, child.id, 'again')).toEqual({ kind: 'already_deactivated' })
    })

    it('forbids non-children, grand-children, yourself and unknown ids', async () => {
      const kanoPu = await byPhone('+2348000000104')
      expect(await deactivateLead(db, who.katsinaWard!, kanoPu.id, 'not mine')).toEqual({ kind: 'forbidden' })
      expect(await deactivateLead(db, who.kanoLga!, kanoPu.id, 'grandchild')).toEqual({ kind: 'forbidden' })
      expect(await deactivateLead(db, who.kanoWard!, who.kanoWard!.id, 'myself')).toEqual({ kind: 'forbidden' })
      expect(await deactivateLead(db, who.kanoWard!, '01900000-0000-7000-8000-000000000000', 'ghost')).toEqual({ kind: 'not_found' })
    })

    it('rejects a reason that contains a phone number (it goes into the audit log)', async () => {
      const kanoPu = await byPhone('+2348000000104')
      await expect(deactivateLead(db, who.kanoWard!, kanoPu.id, 'call him on 08031234567')).rejects.toBeInstanceOf(AuditPiiError)
      expect((await byPhone('+2348000000104')).status).toBe('active')
    })

    it('reset PIN: back to invited without a PIN, sessions and devices revoked, new link sent, audited', async () => {
      const child = await activeChild('19/01/01/007')
      expect(await resetLeadPin(db, who.kanoWard!, child.id, cfg)).toEqual({ kind: 'ok' })
      expect(await byPhone(child.phone)).toMatchObject({ status: 'invited', pinHash: null, sessionVersion: child.sessionVersion + 1 })
      const [device] = await db.select().from(userDevices).where(eq(userDevices.userId, child.id))
      expect(device!.revokedAt).toBeInstanceOf(Date)
      expect(await db.select().from(smsQueue).where(eq(smsQueue.toPhone, child.phone))).toHaveLength(2)
      const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'user.reset_pin'), eq(auditLog.targetId, child.id)))
      expect(entry).toBeDefined()
    })
  })
})
