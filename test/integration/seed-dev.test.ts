import { count, eq, ne } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { unitTargets, units } from '../../server/db/schema'
import { DEV_SOURCE_VERSION, generateDevGeography } from '../../scripts/seed/dev-geography'
import { SeedRefusedError, seedDev } from '../../scripts/seed/run'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const expected = generateDevGeography()

describe.skipIf(!dbAvailable)('dev seed', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  const counts = async () => {
    const [u] = await db.select({ n: count() }).from(units)
    const [t] = await db.select({ n: count() }).from(unitTargets)
    return { units: u!.n, targets: t!.n }
  }

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

  it('refuses to run in production', async () => {
    await expect(seedDev(temp.url, { nodeEnv: 'production' })).rejects.toBeInstanceOf(SeedRefusedError)
    expect(await counts()).toEqual({ units: 0, targets: 0 })
  })

  it('seeds the fake geography and is idempotent', async () => {
    const first = await seedDev(temp.url, { nodeEnv: 'test' })
    expect(first).toEqual({ units: expected.units.length, targets: expected.targets.length })
    expect(await counts()).toEqual({ units: expected.units.length, targets: expected.targets.length })

    await seedDev(temp.url, { nodeEnv: 'test' })
    expect(await counts()).toEqual({ units: expected.units.length, targets: expected.targets.length })

    const [pu] = await db.select().from(units).where(eq(units.code, '19/01/01/001'))
    expect(pu?.location).toEqual(expected.units.find(u => u.code === '19/01/01/001')!.location)
  })

  it('--reset replaces dev rows only', async () => {
    await seedDev(temp.url, { nodeEnv: 'test', reset: true })
    expect(await counts()).toEqual({ units: expected.units.length, targets: expected.targets.length })
    const [nonDev] = await db.select({ n: count() }).from(units).where(ne(units.sourceVersion, DEV_SOURCE_VERSION))
    expect(nonDev!.n).toBe(0)
  })

  it('refuses when real (non-dev) units exist', async () => {
    await db.insert(units).values({
      code: '36',
      level: 'state',
      parentCode: null,
      name: 'ZAMFARA',
      nameNormalised: 'zamfara',
      sourceVersion: 'inec-2023-01',
    })
    await expect(seedDev(temp.url, { nodeEnv: 'test', reset: true })).rejects.toThrow(/real .*units exist/)
    // Nothing was deleted by the refused --reset.
    expect((await counts()).units).toBe(expected.units.length + 1)
  })
})
