// Task 6.3 against Postgres: the PU points of a ward carry locations and the same numbers as the stats.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { units } from '../../server/db/schema'
import { puPoints } from '../../server/services/geo'
import { childrenStats } from '../../server/services/stats'
import { seedDev } from '../../scripts/seed/run'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

describe.skipIf(!dbAvailable)('map PU points', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 2 })
    db = conn.db
    close = () => conn.client.end()
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('lists the ward\u2019s active PUs with a location, matching the stats', async () => {
    const points = await puPoints(db, '19/01/01')
    expect(points).toHaveLength(10)
    const children = (await childrenStats(db, '19/01/01'))!.children
    for (const p of points) {
      expect(p.code.startsWith('19/01/01/')).toBe(true)
      expect(p.lat).toBeGreaterThan(4)
      expect(p.lng).toBeGreaterThan(2)
      const c = children.find(x => x.code === p.code)!
      expect(p.total).toBe(c.supporters)
      expect(p.coverage).toBe(c.coverage)
    }
    expect(JSON.stringify(points)).not.toMatch(/\+234|fullName/)
  })

  it('leaves out deactivated PUs and PUs without a location', async () => {
    await db.update(units).set({ active: false }).where(eq(units.code, '19/01/01/010'))
    await db.update(units).set({ location: null }).where(eq(units.code, '19/01/01/009'))
    expect((await puPoints(db, '19/01/01')).map(p => p.code)).not.toEqual(expect.arrayContaining(['19/01/01/009']))
    expect(await puPoints(db, '19/01/01')).toHaveLength(8)
    expect(await puPoints(db, '19/99/99')).toEqual([])
  })
})
