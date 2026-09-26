import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { units, users } from '../../server/db/schema'
import { normaliseInec, type InecPuRow } from '../../scripts/import/inec'
import { ImportRefusedError, writeUnits } from '../../scripts/import/write-units'
import { DEV_USERS } from '../../scripts/seed/dev-users'
import { SeedRefusedError, seedDev } from '../../scripts/seed/run'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const row = (code: string, puName = `PU ${code}`): InecPuRow => {
  const [stateCode, lgaCode, wardCode, puCode] = code.split('/') as [string, string, string, string]
  return {
    stateCode,
    stateName: stateCode === '19' ? 'KANO' : 'KATSINA',
    lgaCode,
    lgaName: `LGA ${lgaCode}`,
    wardCode,
    wardName: `WARD ${stateCode}/${lgaCode}/${wardCode}`,
    puCode,
    puName,
  }
}

// Covers the dev users' units (19/01/01/001, 20/01/01/001) so the users-only seed can run on it.
const HIERARCHY = [
  row('19/01/01/001'),
  row('19/01/01/002'),
  row('19/01/02/001'),
  row('20/01/01/001'),
]
const normalise = (hierarchy: InecPuRow[], version = 'inec-test-1') => normaliseInec({
  hierarchy,
  coords: new Map([['19/01/01/001', { lat: 12.0, lng: 8.5 }]]),
  sourceVersion: version,
}).units

describe.skipIf(!dbAvailable)('INEC import → units', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  const unitCount = async () => (await db.select({ n: count() }).from(units))[0]!.n
  const get = async (code: string) => (await db.select().from(units).where(eq(units.code, code)))[0]

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    const conn = createDb(temp.url, { max: 2 })
    db = conn.db
    close = () => conn.client.end()
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('a dry run reports the diff and writes nothing', async () => {
    const diff = await writeUnits(db, normalise(HIERARCHY), { dryRun: true })
    expect(diff).toEqual({ added: 11, updated: 0, unchanged: 0, deactivated: 0, reactivated: 0 })
    expect(await unitCount()).toBe(0)
  })

  it('imports every level, passing the DB constraints, with locations', async () => {
    expect(await writeUnits(db, normalise(HIERARCHY))).toMatchObject({ added: 11 })
    expect(await unitCount()).toBe(11)
    expect(await get('19/01/01/001')).toMatchObject({ location: { lat: 12, lng: 8.5 }, locationEstimated: false, active: true })
    expect(await get('19/01/01/002')).toMatchObject({ location: { lat: 12, lng: 8.5 }, locationEstimated: true })
    expect(await get('20/01/01/001')).toMatchObject({ location: null, locationEstimated: true })
  })

  it('is idempotent', async () => {
    expect(await writeUnits(db, normalise(HIERARCHY))).toEqual({ added: 0, updated: 0, unchanged: 11, deactivated: 0, reactivated: 0 })
  })

  it('updates renamed units and deactivates (never deletes) units INEC dropped', async () => {
    const next = [row('19/01/01/001', 'RENAMED PU'), row('19/01/01/002'), row('20/01/01/001')] // 19/01/02/001 dropped
    const diff = await writeUnits(db, normalise(next, 'inec-test-2'))
    // 19/01/02 and 19/01/02/001 disappear; 19/01 (location), 19/01/01/001 (name) change.
    expect(diff).toMatchObject({ added: 0, deactivated: 2 })
    expect(diff.updated).toBeGreaterThanOrEqual(1)
    expect(await get('19/01/01/001')).toMatchObject({ name: 'RENAMED PU', nameNormalised: 'renamed pu', sourceVersion: 'inec-test-2' })
    expect(await get('19/01/02/001')).toMatchObject({ active: false })
    expect(await unitCount()).toBe(11)
  })

  it('reactivates a unit INEC lists again', async () => {
    const diff = await writeUnits(db, normalise(HIERARCHY, 'inec-test-3'))
    expect(diff.reactivated).toBe(2)
    expect(await get('19/01/02/001')).toMatchObject({ active: true })
  })

  it('never wipes a field-reported registered-voters figure on re-import', async () => {
    // Simulates a PU lead's report (task 3.7).
    await db.update(units).set({ registeredVoters: 734 }).where(eq(units.code, '19/01/01/001'))
    const diff = await writeUnits(db, normalise(HIERARCHY, 'inec-test-3')) // import carries NULL voters
    expect(diff.updated).toBe(0)
    expect((await get('19/01/01/001'))!.registeredVoters).toBe(734)
  })

  it('the dev seed adds only dev users on real geography', async () => {
    expect(await seedDev(temp.url, { nodeEnv: 'test' })).toEqual({ units: 0, targets: 0, users: DEV_USERS.length, supporters: 0 })
    expect(await unitCount()).toBe(11)
    const [puLead] = await db.select().from(users).where(eq(users.unitCode, '19/01/01/001'))
    expect(puLead?.role).toBe('PU_LEAD')
  })

  it('refuses to import into a database holding fake dev geography', async () => {
    const devDb = await createTempDatabase()
    try {
      await runMigrations(devDb.url)
      await seedDev(devDb.url, { nodeEnv: 'test' })
      const conn = createDb(devDb.url, { max: 1 })
      try {
        await expect(writeUnits(conn.db, normalise(HIERARCHY))).rejects.toBeInstanceOf(ImportRefusedError)
      }
      finally {
        await conn.client.end()
      }
    }
    finally {
      await devDb.drop()
    }
  })

  it('the dev seed refuses when real geography lacks the dev users\' units', async () => {
    const other = await createTempDatabase()
    try {
      await runMigrations(other.url)
      const conn = createDb(other.url, { max: 1 })
      try {
        await writeUnits(conn.db, normalise([row('19/02/01/001')]))
      }
      finally {
        await conn.client.end()
      }
      await expect(seedDev(other.url, { nodeEnv: 'test' })).rejects.toBeInstanceOf(SeedRefusedError)
    }
    finally {
      await other.drop()
    }
  })
})
