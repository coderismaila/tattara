import { count, eq, ne, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, puStats, supporters, unitTargets, units, users } from '../../server/db/schema'
import { verifyPin } from '../../server/utils/pin'
import { ROLES } from '../../shared/constants/roles'
import { DEV_SOURCE_VERSION, generateDevGeography } from '../../scripts/seed/dev-geography'
import { DEV_SUPPORTER_COUNT } from '../../scripts/seed/dev-supporters'
import { DEV_PIN, DEV_USERS } from '../../scripts/seed/dev-users'
import { SeedRefusedError, seedDev } from '../../scripts/seed/run'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const geo = generateDevGeography()
const expectedCounts = { units: geo.units.length, targets: geo.targets.length, users: DEV_USERS.length, supporters: DEV_SUPPORTER_COUNT }

describe.skipIf(!dbAvailable)('dev seed', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  const counts = async () => {
    const [u] = await db.select({ n: count() }).from(units)
    const [t] = await db.select({ n: count() }).from(unitTargets)
    const [p] = await db.select({ n: count() }).from(users)
    const [s] = await db.select({ n: count() }).from(supporters)
    return { units: u!.n, targets: t!.n, users: p!.n, supporters: s!.n }
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
    expect(await counts()).toEqual({ units: 0, targets: 0, users: 0, supporters: 0 })
  })

  it('seeds geography, targets and users, and is idempotent', async () => {
    expect(await seedDev(temp.url, { nodeEnv: 'test' })).toEqual(expectedCounts)
    expect(await counts()).toEqual(expectedCounts)

    await seedDev(temp.url, { nodeEnv: 'test' })
    expect(await counts()).toEqual(expectedCounts)

    const [pu] = await db.select().from(units).where(eq(units.code, '19/01/01/001'))
    expect(pu?.location).toEqual(geo.units.find(u => u.code === '19/01/01/001')!.location)
  })

  it('creates an active user for every role with the dev PIN and an invite chain', async () => {
    const rows = await db.select().from(users)
    expect(new Set(rows.map(r => r.role))).toEqual(new Set(ROLES))
    expect(rows.every(r => r.status === 'active')).toBe(true)

    const byId = new Map(rows.map(r => [r.id, r]))
    const puLead = rows.find(r => r.unitCode === '19/01/01/001')!
    expect(puLead.role).toBe('PU_LEAD')
    expect(await verifyPin(puLead.pinHash!, DEV_PIN)).toBe(true)
    expect(byId.get(puLead.invitedBy!)?.unitCode).toBe('19/01/01')

    const kanoState = rows.find(r => r.unitCode === '19')!
    expect(byId.get(kanoState.invitedBy!)?.role).toBe('DG')
  })

  it('seeds supporters on the dev PUs by the dev PU leads, with pu_stats matching', async () => {
    const [kanoPu] = await db.select({ id: users.id }).from(users).where(eq(users.unitCode, '19/01/01/001'))
    const rows = await db.select({ capturedBy: supporters.capturedBy, puCode: supporters.puCode }).from(supporters)
    expect(rows.filter(r => r.puCode.startsWith('19/')).every(r => r.capturedBy === kanoPu!.id)).toBe(true)
    const [stats] = await db.select({ total: sql<number>`sum(${puStats.total})::int` }).from(puStats)
    expect(stats!.total).toBe(DEV_SUPPORTER_COUNT)
  })

  it('--reset replaces dev rows only', async () => {
    await seedDev(temp.url, { nodeEnv: 'test', reset: true })
    expect(await counts()).toEqual(expectedCounts)
    const [nonDev] = await db.select({ n: count() }).from(units).where(ne(units.sourceVersion, DEV_SOURCE_VERSION))
    expect(nonDev!.n).toBe(0)
  })

  it('--reset refuses with guidance once audit_log references a dev user', async () => {
    const [dg] = await db.select().from(users).where(eq(users.role, 'DG'))
    await db.insert(auditLog).values({ actorId: dg!.id, actorRole: 'DG', action: 'test.event' })

    await expect(seedDev(temp.url, { nodeEnv: 'test', reset: true })).rejects.toThrow(/docker compose down -v/)
    // The refused reset rolled back: nothing was removed.
    expect(await counts()).toEqual(expectedCounts)
    // A plain (non-reset) re-seed still works.
    expect(await seedDev(temp.url, { nodeEnv: 'test' })).toEqual(expectedCounts)
  })

  it('never adds fake geography once real (non-dev) units exist', async () => {
    await db.insert(units).values({
      code: '36',
      level: 'state',
      parentCode: null,
      name: 'ZAMFARA',
      nameNormalised: 'zamfara',
      sourceVersion: 'inec-2023-01',
    })
    // Users only (their units still exist here); no geography written. Full real-data path: import-inec.test.ts.
    expect(await seedDev(temp.url, { nodeEnv: 'test' })).toEqual({ units: 0, targets: 0, users: DEV_USERS.length, supporters: 0 })
    expect((await counts()).units).toBe(expectedCounts.units + 1)
  })
})
