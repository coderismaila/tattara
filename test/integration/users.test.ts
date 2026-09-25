import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, otpCodes, unitTargets, units, userDevices, users, type NewUser } from '../../server/db/schema'
import { ROLE_LEVEL, type Role } from '../../shared/constants/roles'
import { createTempDatabase, isDbReachable } from './helpers/db'
import { pgErrorCode } from './helpers/pg-error'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

let phoneSeq = 0
function user(role: Role, unitCode: string | null, extra: Partial<NewUser> = {}): NewUser {
  phoneSeq++
  return {
    fullName: `Test ${role}`,
    phone: `+23480312${String(phoneSeq).padStart(5, '0')}`,
    role,
    unitCode,
    unitLevel: ROLE_LEVEL[role],
    pinHash: 'x',
    status: 'active',
    ...extra,
  }
}

describe.skipIf(!dbAvailable)('users, devices, OTPs and audit schema', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    const conn = createDb(temp.url, { max: 2 })
    db = conn.db
    close = () => conn.client.end()

    const base = { sourceVersion: 'test' }
    await db.insert(units).values([
      { code: '19', level: 'state', parentCode: null, name: 'KANO', nameNormalised: 'kano', ...base },
      { code: '19/05', level: 'lga', parentCode: '19', name: 'L', nameNormalised: 'l', ...base },
      { code: '19/05/03', level: 'ward', parentCode: '19/05', name: 'W', nameNormalised: 'w', ...base },
      { code: '19/05/03/012', level: 'pu', parentCode: '19/05/03', name: 'P', nameNormalised: 'p', ...base },
    ])
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('accepts a lead at the matching level and generates a UUIDv7 id', async () => {
    const [row] = await db.insert(users).values(user('PU_LEAD', '19/05/03/012')).returning()
    expect(row!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
    expect(row).toMatchObject({ status: 'active', sessionVersion: 0, failedPinAttempts: 0 })
  })

  it('accepts DG and ADMIN without a unit', async () => {
    expect(await pgErrorCode(db.insert(users).values([user('DG', null), user('ADMIN', null)]))).toBeUndefined()
  })

  it.each([
    ['PU lead on a ward', user('PU_LEAD', '19/05/03', { unitLevel: 'ward' })],
    ['ward lead claiming PU level', user('WARD_LEAD', '19/05/03/012', { unitLevel: 'pu' })],
    ['DG with a unit', user('DG', '19', { unitLevel: 'state' })],
    ['state lead without a unit', user('STATE_LEAD', null, { unitLevel: null })],
    ['active user without a PIN', user('LGA_LEAD', '19/05', { pinHash: null })],
    ['local phone format', user('LGA_LEAD', '19/05', { phone: '08031234567' })],
    ['landline', user('LGA_LEAD', '19/05', { phone: '+2346412345678' })],
    ['blank name', user('LGA_LEAD', '19/05', { fullName: '  ' })],
  ])('rejects %s (check constraint)', async (_label, row) => {
    expect(await pgErrorCode(db.insert(users).values(row))).toBe('23514')
  })

  it('rejects a unit_level that disagrees with the unit (composite FK)', async () => {
    // Passes the role CHECK (ward lead + 'ward') but 19/05 is an LGA.
    expect(await pgErrorCode(db.insert(users).values(user('WARD_LEAD', '19/05', { unitLevel: 'ward' })))).toBe('23503')
  })

  it('allows one active lead per unit, plus invited/deactivated ones', async () => {
    await db.insert(users).values(user('WARD_LEAD', '19/05/03'))
    expect(await pgErrorCode(db.insert(users).values(user('WARD_LEAD', '19/05/03')))).toBe('23505')
    expect(await pgErrorCode(db.insert(users).values(user('WARD_LEAD', '19/05/03', { status: 'invited', pinHash: null })))).toBeUndefined()
    expect(await pgErrorCode(db.insert(users).values(user('WARD_LEAD', '19/05/03', { status: 'deactivated' })))).toBeUndefined()
  })

  it('rejects duplicate phones', async () => {
    const u = user('STATE_LEAD', '19')
    await db.insert(users).values(u)
    expect(await pgErrorCode(db.insert(users).values({ ...u, role: 'DG', unitCode: null, unitLevel: null }))).toBe('23505')
  })

  it('binds a device once per user', async () => {
    const [u] = await db.insert(users).values(user('LGA_LEAD', '19/05')).returning()
    await db.insert(userDevices).values({ userId: u!.id, deviceId: 'dev-1' })
    expect(await pgErrorCode(db.insert(userDevices).values({ userId: u!.id, deviceId: 'dev-1' }))).toBe('23505')
  })

  it('caps OTP attempts at 5', async () => {
    const [otp] = await db.insert(otpCodes).values({
      phone: '+2348031234567',
      purpose: 'device',
      codeHash: 'h',
      expiresAt: new Date(Date.now() + 600_000),
      attempts: 5,
    }).returning()
    expect(await pgErrorCode(db.update(otpCodes).set({ attempts: 6 }).where(eq(otpCodes.id, otp!.id)))).toBe('23514')
  })

  it('enforces unit_targets.set_by → users', async () => {
    const [dg] = await db.select().from(users).where(eq(users.role, 'DG'))
    expect(await pgErrorCode(db.insert(unitTargets).values({ unitCode: '19', target: 10, setBy: dg!.id }))).toBeUndefined()
    expect(await pgErrorCode(db.insert(unitTargets).values({
      unitCode: '19/05',
      target: 10,
      setBy: '01900000-0000-7000-8000-000000000000',
    }))).toBe('23503')
  })

  describe('audit_log', () => {
    it('accepts inserts', async () => {
      const [row] = await db.insert(auditLog).values({
        action: 'user.create',
        targetType: 'user',
        targetId: 'abc',
        scopeCode: '19/05',
        ip: '203.0.113.7',
        meta: { role: 'LGA_LEAD' },
      }).returning()
      expect(row).toMatchObject({ action: 'user.create', meta: { role: 'LGA_LEAD' } })
      expect(row!.id).toBeGreaterThan(0)
    })

    it('rejects UPDATE, DELETE and TRUNCATE', async () => {
      expect(await pgErrorCode(db.update(auditLog).set({ action: 'tampered' }))).toBe('42501')
      expect(await pgErrorCode(db.delete(auditLog))).toBe('42501')
      expect(await pgErrorCode(db.execute(sql`truncate audit_log`))).toBe('42501')
      const rows = await db.select().from(auditLog)
      expect(rows.map(r => r.action)).toEqual(['user.create'])
    })
  })
})
