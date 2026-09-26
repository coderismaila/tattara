import { and, desc, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, smsQueue, userDevices, users } from '../../server/db/schema'
import { createRegionUser, currentDg, inviteDg } from '../../server/services/admin'
import { type AuthConfig, completeSetup } from '../../server/services/auth'
import { seedDev } from '../../scripts/seed/run'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const cfg: AuthConfig = { otpSecret: 'test-otp-secret-that-is-at-least-32-chars', siteUrl: 'https://tattara.test' }
const SEEDED_DG = '+2348000000002'
let phoneSeq = 0
const newPhone = () => `+23480366${String(++phoneSeq).padStart(5, '0')}`

describe.skipIf(!dbAvailable)('admin service', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  let admin: { id: string, role: 'ADMIN' }

  const byPhone = async (phone: string) => (await db.select().from(users).where(eq(users.phone, phone)))[0]!
  const auditFor = (targetId: string) => db.select().from(auditLog).where(eq(auditLog.targetId, targetId)).orderBy(desc(auditLog.id))

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    admin = { id: (await byPhone('+2348000000001')).id, role: 'ADMIN' }
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('currentDg shows the active DG with a masked phone', async () => {
    expect(await currentDg(db)).toMatchObject({ fullName: 'Dev DG', status: 'active', phone: '+234 80* *** 0002' })
  })

  it('refuses a second DG while one is active, without writing anything', async () => {
    const phone = newPhone()
    expect(await createRegionUser(db, { role: 'DG', fullName: 'Second DG', phone, createdBy: admin })).toEqual({ kind: 'dg_exists' })
    expect(await db.select().from(users).where(eq(users.phone, phone))).toHaveLength(0)
  })

  it('refuses a phone that belongs to an active user or to another role\'s pending invite', async () => {
    expect(await createRegionUser(db, { role: 'DG', fullName: 'X Y', phone: '+2348000000103', replace: true, createdBy: admin }))
      .toEqual({ kind: 'phone_in_use' })
    const pending = newPhone()
    await db.insert(users).values({ fullName: 'Pending PU', phone: pending, role: 'PU_LEAD', unitCode: '19/01/01/009', unitLevel: 'pu', status: 'invited' })
    expect(await createRegionUser(db, { role: 'DG', fullName: 'X Y', phone: pending, replace: true, createdBy: admin }))
      .toEqual({ kind: 'phone_in_use' })
    expect((await byPhone(pending)).role).toBe('PU_LEAD')
  })

  it('creates an invited ADMIN from the CLI; the token sets the PIN', async () => {
    const phone = newPhone()
    const r = await createRegionUser(db, { role: 'ADMIN', fullName: 'Umar Adam Ibrahim', phone, createdBy: null })
    if (r.kind !== 'ok') throw new Error(r.kind)
    expect(await byPhone(phone)).toMatchObject({ role: 'ADMIN', status: 'invited', unitCode: null, pinHash: null, invitedBy: null })
    expect((await auditFor(r.userId))[0]).toMatchObject({ action: 'user.create', actorId: null, meta: { role: 'ADMIN', via: 'cli' } })

    const setup = await completeSetup(db, { token: r.token, pin: '705312', deviceId: uuidv7() })
    expect(setup.kind).toBe('ok')
    expect((await byPhone(phone)).status).toBe('active')
  })

  it('replace deactivates the active DG (sessions and devices) and invites the new one by SMS', async () => {
    const old = await byPhone(SEEDED_DG)
    const phone = newPhone()
    const r = await inviteDg(db, admin, { fullName: 'New DG', phone, replace: true }, cfg)
    if (r.kind !== 'ok') throw new Error(r.kind)
    expect(r).not.toHaveProperty('token')
    expect(r.replacedUserId).toBe(old.id)

    const after = await byPhone(SEEDED_DG)
    expect(after.status).toBe('deactivated')
    expect(after.sessionVersion).toBe(old.sessionVersion + 1)
    const devices = await db.select().from(userDevices).where(eq(userDevices.userId, old.id))
    expect(devices.every(d => d.revokedAt !== null)).toBe(true)

    expect(await byPhone(phone)).toMatchObject({ role: 'DG', status: 'invited', invitedBy: admin.id })
    const [sms] = await db.select().from(smsQueue).where(and(eq(smsQueue.toPhone, phone), eq(smsQueue.purpose, 'invite')))
    expect(sms!.body).toContain('https://tattara.test/setup?t=')

    expect((await auditFor(old.id))[0]).toMatchObject({ action: 'user.deactivate', actorId: admin.id, meta: { reason: 'replaced', via: 'admin' } })
    const [created] = await auditFor(r.userId)
    expect(created).toMatchObject({ action: 'user.create', actorId: admin.id, actorRole: 'ADMIN', meta: { role: 'DG', via: 'admin' } })
    expect(JSON.stringify(created!.meta)).not.toContain(phone.slice(4))

    expect(await currentDg(db)).toMatchObject({ id: r.userId, fullName: 'New DG', status: 'invited' })
  })

  it('a new invite supersedes the pending DG; re-inviting the same person resends', async () => {
    const pending = await currentDg(db)
    const phone = newPhone()
    const r = await inviteDg(db, admin, { fullName: 'Newer DG', phone }, cfg)
    if (r.kind !== 'ok') throw new Error(r.kind)
    expect((await db.select().from(users).where(eq(users.id, pending!.id)))[0]!.status).toBe('deactivated')

    const again = await inviteDg(db, admin, { fullName: 'Newer DG', phone }, cfg)
    expect(again).toMatchObject({ kind: 'ok', userId: r.userId })
    expect(await db.select().from(smsQueue).where(eq(smsQueue.toPhone, phone))).toHaveLength(2)
    expect(await db.select().from(users).where(and(eq(users.role, 'DG'), eq(users.status, 'invited')))).toHaveLength(1)
  })
})
