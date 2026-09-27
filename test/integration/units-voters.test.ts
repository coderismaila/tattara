import { and, desc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, units, users } from '../../server/db/schema'
import { registeredVotersSummary, setRegisteredVoters } from '../../server/services/units'
import { seedDev } from '../../scripts/seed/run'
import type { SessionUser } from '../../shared/types/auth'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

describe.skipIf(!dbAvailable)('registered voters from the field (US-24)', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const who: Record<string, SessionUser> = {}

  const asCaller = async (phone: string): Promise<SessionUser> => {
    const [u] = await db.select().from(users).where(eq(users.phone, phone))
    return { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
  }
  const unit = async (code: string) => (await db.select().from(units).where(eq(units.code, code)))[0]!

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    who.admin = await asCaller('+2348000000001')
    who.dg = await asCaller('+2348000000002')
    who.kanoLga = await asCaller('+2348000000102')
    who.kanoWard = await asCaller('+2348000000103') // 19/01/01
    who.kanoPu = await asCaller('+2348000000104') // 19/01/01/001
    who.katsinaWard = await asCaller('+2348000000203')
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('the PU lead records their own PU: figure, who and when, audited with old and new numbers', async () => {
    const before = (await unit('19/01/01/001')).registeredVoters
    const r = await setRegisteredVoters(db, who.kanoPu!, '19/01/01/001', 612)
    expect(r).toMatchObject({ kind: 'ok', summary: { code: '19/01/01/001', level: 'pu', registeredVoters: 612, pusWithFigure: 1, totalPus: 1 } })

    const row = await unit('19/01/01/001')
    expect(row).toMatchObject({ registeredVoters: 612, registeredVotersReportedBy: who.kanoPu!.id })
    expect(row.registeredVotersReportedAt).toBeInstanceOf(Date)

    const [entry] = await db.select().from(auditLog)
      .where(and(eq(auditLog.action, 'unit.registered_voters'), eq(auditLog.targetId, '19/01/01/001'))).orderBy(desc(auditLog.id))
    expect(entry).toMatchObject({ actorId: who.kanoPu!.id, scopeCode: '19/01/01/001', meta: { from: before, to: 612 } })
  })

  it('a first report on a PU with no figure yet works (and audits from: null)', async () => {
    await db.update(units).set({ registeredVoters: null }).where(eq(units.code, '19/01/01/006'))
    expect(await setRegisteredVoters(db, who.kanoWard!, '19/01/01/006', 275)).toMatchObject({ kind: 'ok', summary: { registeredVoters: 275 } })
    const [entry] = await db.select().from(auditLog)
      .where(and(eq(auditLog.action, 'unit.registered_voters'), eq(auditLog.targetId, '19/01/01/006'))).orderBy(desc(auditLog.id))
    expect(entry!.meta).toEqual({ from: null, to: 275 })
  })

  it('the ward lead can correct any PU in their ward', async () => {
    expect(await setRegisteredVoters(db, who.kanoWard!, '19/01/01/004', 350)).toMatchObject({ kind: 'ok' })
    expect(await unit('19/01/01/004')).toMatchObject({ registeredVoters: 350, registeredVotersReportedBy: who.kanoWard!.id })
  })

  it.each([
    ['a PU lead, for another PU', 'kanoPu', '19/01/01/002'],
    ['a ward lead, outside their ward', 'katsinaWard', '19/01/01/002'],
    ['a ward lead, for a PU in another ward', 'kanoWard', '19/01/02/001'],
    ['an LGA lead', 'kanoLga', '19/01/01/002'],
    ['the DG', 'dg', '19/01/01/002'],
    ['the admin', 'admin', '19/01/01/002'],
    ['anyone, for a ward code', 'kanoWard', '19/01/01'],
  ])('refuses %s', async (_label, caller, code) => {
    expect(await setRegisteredVoters(db, who[caller]!, code, 100)).toEqual({ kind: 'forbidden' })
  })

  it.each([-1, 1.5, 10_001, Number.NaN])('refuses %s', async (count) => {
    expect(await setRegisteredVoters(db, who.kanoPu!, '19/01/01/001', count)).toEqual({ kind: 'invalid' })
  })

  it('an inactive PU is not found', async () => {
    await db.update(units).set({ active: false }).where(eq(units.code, '19/01/01/009'))
    try {
      expect(await setRegisteredVoters(db, who.kanoWard!, '19/01/01/009', 100)).toEqual({ kind: 'not_found' })
    }
    finally {
      await db.update(units).set({ active: true }).where(eq(units.code, '19/01/01/009'))
    }
  })

  describe('summary', () => {
    it('sums the PUs that have a figure and says how many do', async () => {
      await db.update(units).set({ registeredVoters: null }).where(eq(units.code, '19/01/01/010'))
      const pus = await db.select({ code: units.code, v: units.registeredVoters }).from(units).where(and(eq(units.parentCode, '19/01/01'), eq(units.level, 'pu')))
      const expected = pus.reduce((sum, p) => sum + (p.v ?? 0), 0)

      expect(await registeredVotersSummary(db, '19/01/01')).toEqual({
        code: '19/01/01', level: 'ward', registeredVoters: expected, reportedAt: null, pusWithFigure: 9, totalPus: 10,
      })
    })

    it('rolls up to the LGA, state and region', async () => {
      const lga = await registeredVotersSummary(db, '19/01')
      const state = await registeredVotersSummary(db, '19')
      const region = await registeredVotersSummary(db, '')
      expect(lga).toMatchObject({ level: 'lga', totalPus: 40, pusWithFigure: 39 })
      expect(state).toMatchObject({ level: 'state', totalPus: 120 })
      expect(region).toMatchObject({ code: '', level: 'region', totalPus: 240 })
      expect(region!.registeredVoters!).toBeGreaterThan(state!.registeredVoters!)
    })

    it('a PU with no figure reports null, and unknown codes give null', async () => {
      expect(await registeredVotersSummary(db, '19/01/01/010')).toMatchObject({ registeredVoters: null, pusWithFigure: 0, totalPus: 1 })
      expect(await registeredVotersSummary(db, '19/09/09/999')).toBeNull()
      expect(await registeredVotersSummary(db, 'not-a-code')).toBeNull()
    })
  })

  it('the database keeps who and when together', async () => {
    await expect(db.update(units).set({ registeredVotersReportedAt: new Date() }).where(eq(units.code, '19/01/01/005')))
      .rejects.toMatchObject({ cause: { constraint_name: 'units_registered_voters_reported' } })
  })
})
