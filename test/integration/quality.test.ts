// Task 5.5 against Postgres: per-PU counts and the roll-up to ward, LGA and state; dismissed flags and old supporters
// leave the score; the Team list carries it.
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { flags, unitQuality, users } from '../../server/db/schema'
import { computeQuality } from '../../server/services/quality'
import { listTeam } from '../../server/services/team'
import { seedDev } from '../../scripts/seed/run'
import type { SessionUser } from '../../shared/types/auth'
import { qualityScore } from '../../shared/utils/quality'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const PU = '19/01/01/001'
const WARD = '19/01/01'

describe.skipIf(!dbAvailable)('lead quality', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  const stored = async (code: string) => (await db.select().from(unitQuality).where(eq(unitQuality.unitCode, code)))[0]
  /** The same counts, straight from the tables (independent of the service's query). */
  const countsFor = async (prefix: string) => {
    const [row] = await db.execute<{ supporters: number, verified: number, opted_out: number, flags: number }>(sql`
      select
        (select count(*)::int from supporters where pu_code like ${`${prefix}%`} and created_at > now() - interval '90 days') as supporters,
        (select count(*)::int from supporters where pu_code like ${`${prefix}%`} and created_at > now() - interval '90 days'
          and verification in ('sms_delivered', 'callback_verified')) as verified,
        (select count(*)::int from supporters where pu_code like ${`${prefix}%`} and created_at > now() - interval '90 days'
          and verification = 'opted_out') as opted_out,
        (select count(*)::int from flags where pu_code like ${`${prefix}%`} and status in ('open', 'confirmed')
          and created_at > now() - interval '90 days') as flags`)
    return row!
  }

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' }) // raises the planted flags and computes quality once
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('scores every unit with supporters, from the PU up to the state', async () => {
    for (const code of [PU, WARD, '19/01', '19', '20']) {
      const q = await stored(code)
      const c = await countsFor(code)
      expect(q, code).toBeDefined()
      expect(q!.supporters).toBe(c.supporters)
      expect(q!.verifiedRate).toBeCloseTo(c.verified / c.supporters, 5)
      expect(q!.optOutRate).toBeCloseTo(c.opted_out / c.supporters, 5)
      expect(q!.flagRate).toBeCloseTo(c.flags / c.supporters, 5)
      expect(q!.score).toBe(qualityScore({ supporters: c.supporters, verified: c.verified, flags: c.flags, optedOut: c.opted_out, callsVerified: 0, callsFailed: 0 }).score)
    }
  })

  it('a ward is the sum of its PUs', async () => {
    const pus = await db.select().from(unitQuality).where(sql`${unitQuality.unitCode} like ${`${WARD}/%`}`)
    expect((await stored(WARD))!.supporters).toBe(pus.reduce((n, p) => n + p.supporters, 0))
  })

  it('dismissed flags stop counting', async () => {
    const busy = (await db.execute<{ pu_code: string }>(sql`select pu_code from flags where status = 'open' group by pu_code order by count(*) desc limit 1`))[0]!.pu_code
    expect((await stored(busy))!.flagRate).toBeGreaterThan(0)
    await db.update(flags).set({ status: 'dismissed', reviewedAt: sql`now()` }).where(eq(flags.puCode, busy))
    await computeQuality(db)
    expect((await stored(busy))!.flagRate).toBe(0)
  })

  it('supporters older than 90 days leave the score (and a unit with none is dropped)', async () => {
    const pu = '20/01/01/002'
    expect(await stored(pu)).toBeDefined()
    await db.execute(sql`update supporters set created_at = now() - interval '91 days' where pu_code = ${pu}`)
    await computeQuality(db)
    expect(await stored(pu)).toBeUndefined()
  })

  it('the Team list shows each child unit\'s score and breakdown', async () => {
    const [u] = await db.select().from(users).where(eq(users.phone, '+2348000000103'))
    const ward: SessionUser = { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
    const r = await listTeam(db, ward)
    if (r.kind !== 'ok') throw new Error(r.kind)
    const row = r.members.find(m => m.code === PU)!
    const q = (await stored(PU))!
    expect(row.qualityScore).toBe(q.score)
    expect(row.quality).toMatchObject({ supporters: q.supporters, verifiedRate: q.verifiedRate, computedAt: expect.any(String) })
  })
})
