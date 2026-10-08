// Task 6.1 against Postgres (dev seed): unit totals and roll-ups, coverage skipping PUs without a figure, children
// rows and ordering, active leads, the daily snapshot and the pu_stats reconcile.
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { puStats, unitDailyStats, unitTargets, units } from '../../server/db/schema'
import { childrenStats, reconcilePuStats, unitStats, writeDailyStats } from '../../server/services/stats'
import { seedDev } from '../../scripts/seed/run'
import { lagosDate } from '../../shared/utils/lagos-date'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const WARD = '19/01/01'
const PU = '19/01/01/001'

describe.skipIf(!dbAvailable)('stats', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  /** Independent sums straight from pu_stats and units. */
  const expected = async (prefix: string) => {
    const [r] = await db.execute<{ supporters: number, covered: number, voters: number | null, with_figure: number, pus: number }>(sql`
      select coalesce(sum(p.total), 0)::int as supporters,
        coalesce(sum(p.total) filter (where u.registered_voters is not null), 0)::int as covered,
        sum(u.registered_voters)::int as voters,
        count(u.registered_voters)::int as with_figure, count(*)::int as pus
      from units u left join pu_stats p on p.pu_code = u.code
      where u.level = 'pu' and u.code like ${`${prefix}%`}`)
    return r!
  }

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('unitStats', () => {
    it('rolls pu_stats up to a ward, with coverage over PUs that have a figure', async () => {
      await db.update(units).set({ registeredVoters: null }).where(eq(units.code, '19/01/01/002')) // one unreported PU
      const s = (await unitStats(db, WARD))!
      const e = await expected(WARD)
      expect(s.unit).toEqual({ code: WARD, name: expect.any(String), level: 'ward' })
      expect(s.totals.supporters).toBe(e.supporters)
      expect(s.registeredVoters).toEqual({ sum: e.voters, pusWithFigure: e.with_figure, totalPus: e.pus })
      expect(s.registeredVoters.pusWithFigure).toBe(e.pus - 1)
      expect(s.coverage).toBeCloseTo(e.covered / e.voters!, 6)
      expect(s.coverage).not.toBeCloseTo(e.supporters / e.voters!, 6) // the unreported PU's supporters are left out
      expect(s.totals.support.strong + s.totals.support.leaning + s.totals.support.undecided).toBe(s.totals.supporters)
      expect(JSON.stringify(s)).not.toMatch(/\+234|fullName/)
    })

    it('the region is everything; a target gives progress; unknown codes are null', async () => {
      const region = (await unitStats(db, ''))!
      expect(region.unit.level).toBe('region')
      expect(region.totals.supporters).toBe((await expected('')).supporters)
      const [t] = await db.select().from(unitTargets).where(eq(unitTargets.unitCode, WARD))
      const ward = (await unitStats(db, WARD))!
      expect(ward.target).toBe(t?.target ?? null)
      if (t) expect(ward.progress).toBeCloseTo(ward.totals.supporters / t.target, 6)
      expect(await unitStats(db, '19/99')).toBeNull()
    })

    it('a PU without a figure has no coverage', async () => {
      const s = (await unitStats(db, '19/01/01/002'))!
      expect(s.coverage).toBeNull()
      expect(s.registeredVoters).toEqual({ sum: null, pusWithFigure: 0, totalPus: 1 })
    })
  })

  describe('childrenStats', () => {
    it('one row per child, coverage lowest first and units without coverage last', async () => {
      const c = (await childrenStats(db, WARD))!
      expect(c.children).toHaveLength(10)
      expect(c.children.every(r => r.level === 'pu' && r.code.startsWith(`${WARD}/`))).toBe(true)
      expect(c.children.at(-1)!.code).toBe('19/01/01/002') // no figure → last
      const values = c.children.map(r => r.coverage).filter((v): v is number => v !== null)
      expect(values).toEqual([...values].sort((a, b) => a - b))
      expect(c.children.find(r => r.code === PU)!.activeLeads).toBe(1)
    })

    it('sorts by any metric, either way; the region lists states; PUs have no children', async () => {
      const desc = (await childrenStats(db, '19/01', 'supporters', 'desc'))!
      const sizes = desc.children.map(r => r.supporters)
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
      const region = (await childrenStats(db, ''))!
      expect(region.children.map(r => r.code).sort()).toEqual(['19', '20'])
      expect(region.children.find(r => r.code === '19')!.activeLeads).toBeGreaterThanOrEqual(4) // the Kano chain
      expect((await childrenStats(db, PU))!.children).toEqual([])
      expect(await childrenStats(db, '19/99')).toBeNull()
    })
  })

  describe('nightly tasks', () => {
    it('the daily snapshot covers every level and the region, and overwrites on a rerun', async () => {
      const day = lagosDate()
      const written = await writeDailyStats(db, day)
      const rows = await db.select().from(unitDailyStats).where(eq(unitDailyStats.day, day))
      expect(rows).toHaveLength(written)
      const codes = new Set(rows.map(r => r.unitCode))
      for (const code of ['all', '19', '19/01', WARD, PU]) expect(codes.has(code), code).toBe(true)
      const region = rows.find(r => r.unitCode === 'all')!
      expect(region.total).toBe((await expected('')).supporters)

      await db.update(puStats).set({ total: sql`${puStats.total} + 1` }).where(eq(puStats.puCode, PU))
      expect(await writeDailyStats(db, day)).toBe(written)
      const [again] = await db.select().from(unitDailyStats).where(sql`${unitDailyStats.unitCode} = 'all' and ${unitDailyStats.day} = ${day}`)
      expect(again!.total).toBe(region.total + 1)
      expect((await unitStats(db, WARD))!.last30Days.at(-1)).toMatchObject({ day })
    })

    it('reconcile finds drifted PUs and rebuilds pu_stats', async () => {
      // The previous test bumped PU's total by hand: that is drift.
      const first = await reconcilePuStats(db)
      expect(first.drifted).toBe(1)
      expect(first.sample).toEqual([PU])
      expect(await reconcilePuStats(db)).toEqual({ drifted: 0, sample: [] })
    })
  })
})
