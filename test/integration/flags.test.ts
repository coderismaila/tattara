// Task 5.1: the flag engine against Postgres, one block per flag type. Fixtures: the dev seed's planted patterns
// (scripts/seed/dev-supporters.ts), which the seed turns into flags, plus hand-made edge cases. Each check must find
// exactly what was planted, never block anything, never re-raise a reviewed flag, and keep evidence free of PII.
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { flags, puStats, units, users } from '../../server/db/schema'
import { runFlagChecks, type FlagCheckResult } from '../../server/services/flags'
import { createSupporter } from '../../server/services/supporters'
import { generateDevGeography } from '../../scripts/seed/dev-geography'
import { generateDevSupporters, type DevSupporterPatterns } from '../../scripts/seed/dev-supporters'
import { seedDev } from '../../scripts/seed/run'
import { GPS_CLUSTER_MIN, RATE_ANOMALY_PER_HOUR } from '../../shared/constants/flags'
import type { FlagType } from '../../shared/constants/enums'
import type { SessionUser } from '../../shared/types/auth'
import type { SupporterInput } from '../../shared/types/supporter'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const PU = '19/01/01/001'
const NONE: FlagCheckResult = { gps_far: 0, duplicate_phone: 0, pu_over_capacity: 0, rate_anomaly: 0, gps_cluster: 0 }
let phoneSeq = 0
const nextPhone = () => `+23480399${String(70000 + phoneSeq++).padStart(5, '0').slice(-5)}`
const KM_IN_DEG = 1 / 111

describe.skipIf(!dbAvailable)('flag engine', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  let patterns: DevSupporterPatterns
  let puLead: SessionUser
  let reviewer: string
  let puLocation: { lat: number, lng: number }

  const asCaller = async (phone: string): Promise<SessionUser> => {
    const [u] = await db.select().from(users).where(eq(users.phone, phone))
    return { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
  }
  const flagsOf = (type: FlagType) => db.select().from(flags).where(eq(flags.type, type))
  const flaggedIds = async (type: FlagType) => new Set((await flagsOf(type)).map(f => f.supporterId))
  const dismiss = (type: FlagType) => db.update(flags)
    .set({ status: 'dismissed', reviewedAt: sql`now()`, reviewedBy: reviewer })
    .where(and(eq(flags.type, type), eq(flags.status, 'open')))
  /** A supporter on the Kano PU lead's PU, `kmNorth` from the PU's point (null = no GPS). */
  const add = async (over: Partial<SupporterInput> & { kmNorth?: number | null } = {}) => {
    const { kmNorth = 0.1, ...rest } = over
    const now = new Date().toISOString()
    const input: SupporterInput = {
      id: newId(), puCode: PU, fullName: 'Flag Test', phone: nextPhone(), sharedPhone: false, address: null, gender: null,
      ageBand: null, supportLevel: 'strong', hasPvc: 'yes', volunteer: false, consentAt: now, consentVersion: 'c1-ha',
      consentLanguage: 'ha', capturedAt: now, deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
      gps: kmNorth === null ? null : { lat: puLocation.lat + kmNorth * KM_IN_DEG, lng: puLocation.lng, accuracyM: 10 },
      ...rest,
    }
    const r = await createSupporter(db, puLead, input)
    if (r.kind !== 'accepted') throw new Error(r.kind)
    return r.supporter.id
  }

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' }) // runs the full scan once, as the nightly task would
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    puLead = await asCaller('+2348000000104')
    reviewer = (await asCaller('+2348000000103')).id
    const pus = generateDevGeography().units.filter(u => u.level === 'pu')
    patterns = generateDevSupporters(pus, { 19: 'x', 20: 'y' }).patterns
    const [loc] = await db.execute<{ lat: number, lng: number }>(
      sql`select ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng from units where code = ${PU}`)
    puLocation = loc!
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('the planted patterns (full scan)', () => {
    it('gps_far: exactly the captures planted 5–15 km away, with the distance as evidence', async () => {
      const found = await flagsOf('gps_far')
      expect(new Set(found.map(f => f.supporterId))).toEqual(new Set(patterns.farIds))
      for (const f of found) {
        const d = f.details as { distanceM: number, thresholdM: number, puLocationEstimated: boolean }
        expect(d.distanceM).toBeGreaterThan(4000)
        expect(d).toMatchObject({ thresholdM: 3000, puLocationEstimated: false })
      }
    })

    it('duplicate_phone: every later use of a planted number, never the first one', async () => {
      const found = await flagsOf('duplicate_phone')
      expect(found).toHaveLength(30 * 1 + 10 * 2)
      const rows = await db.execute<{ id: string, phone: string, first: boolean }>(sql`
        select id, phone, row_number() over (partition by phone order by created_at, id) = 1 as first
        from supporters where phone in ${patterns.duplicatePhones}`)
      const flagged = new Set(found.map(f => f.supporterId))
      for (const r of rows) expect(flagged.has(r.id)).toBe(!r.first)
      const triple = found.find(f => (f.details as { uses: number }).uses === 3)!
      expect(triple.details).toMatchObject({ uses: 3, sharedPhone: true })
    })

    it('pu_over_capacity: the one PU above 90% of its registered voters', async () => {
      const found = await flagsOf('pu_over_capacity')
      expect(found.map(f => [f.puCode, f.supporterId, f.userId])).toEqual([[patterns.overCapacityPu, null, null]])
      const d = found[0]!.details as { supporters: number, registeredVoters: number, ratio: number }
      expect(d.supporters).toBeGreaterThan(d.registeredVoters * d.ratio)
    })

    it('rate_anomaly: the lead behind the planted burst, once, with the busiest hour', async () => {
      const found = await flagsOf('rate_anomaly')
      expect(found).toHaveLength(1)
      const [lead] = await db.select({ id: users.id }).from(users)
        .where(eq(users.phone, patterns.burstPu.startsWith('19') ? '+2348000000104' : '+2348000000204'))
      expect(found[0]).toMatchObject({ userId: lead!.id, supporterId: null, puCode: patterns.burstPu })
      expect((found[0]!.details as { count: number }).count).toBeGreaterThanOrEqual(patterns.burstCount)
    })

    it('gps_cluster: the 25 captures sharing one fix', async () => {
      const found = await flagsOf('gps_cluster')
      expect(found).toHaveLength(patterns.clusterCount)
      expect(found.every(f => f.puCode === patterns.clusterPu && (f.details as { clusterSize: number }).clusterSize === patterns.clusterCount)).toBe(true)
    })

    it('evidence holds no names, phones or coordinates', async () => {
      const all = await db.select({ details: flags.details }).from(flags)
      const allowed = new Set(['distanceM', 'accuracyM', 'thresholdM', 'puLocationEstimated', 'uses', 'samePu', 'sharedPhone',
        'supporters', 'registeredVoters', 'ratio', 'count', 'limit', 'windowStart', 'windowEnd', 'clusterSize'])
      for (const { details } of all) {
        expect(Object.keys(details as object).filter(k => !allowed.has(k))).toEqual([])
        expect(JSON.stringify(details)).not.toMatch(/\+234|\d{10}/)
      }
    })

    it('pu_stats.flagged_open matches the open flags of each PU', async () => {
      const rows = await db.execute<{ pu_code: string, flagged_open: number, open: number }>(sql`
        select p.pu_code, p.flagged_open, (select count(*)::int from flags f where f.pu_code = p.pu_code and f.status = 'open') as open
        from pu_stats p`)
      expect(rows.filter(r => r.flagged_open !== r.open)).toEqual([])
      expect(rows.reduce((n, r) => n + r.flagged_open, 0)).toBe((await db.select().from(flags)).length)
    })

    it('a second scan raises nothing new', async () => {
      expect(await runFlagChecks(db)).toEqual(NONE)
    })
  })

  describe('after a sync (scoped to the new records)', () => {
    it('gps_far allows for the reported accuracy', async () => {
      const near = await add({ kmNorth: 3.5 })
      const fuzzy = await add({ kmNorth: null, gps: { lat: puLocation.lat + 3.5 * KM_IN_DEG, lng: puLocation.lng, accuracyM: 800 } })
      const far = await add({ kmNorth: 6 })
      expect(await runFlagChecks(db, { supporterIds: [near, fuzzy, far] })).toMatchObject({ gps_far: 2 })
      const ids = await flaggedIds('gps_far')
      expect([ids.has(near), ids.has(fuzzy), ids.has(far)]).toEqual([true, false, true])
    })

    it('gps_far uses the wider 10 km limit when the PU location is estimated', async () => {
      await db.update(units).set({ locationEstimated: true }).where(eq(units.code, PU))
      try {
        const six = await add({ kmNorth: 6 })
        const twelve = await add({ kmNorth: 12 })
        await runFlagChecks(db, { supporterIds: [six, twelve] })
        const ids = await flaggedIds('gps_far')
        expect([ids.has(six), ids.has(twelve)]).toEqual([false, true])
        const [flag] = await db.select().from(flags).where(eq(flags.supporterId, twelve))
        expect(flag!.details).toMatchObject({ thresholdM: 10_000, puLocationEstimated: true })
      }
      finally {
        await db.update(units).set({ locationEstimated: false }).where(eq(units.code, PU))
      }
    })

    it('duplicate_phone flags the new record on a known number, and only that one', async () => {
      const phone = nextPhone()
      const first = await add({ phone })
      expect(await runFlagChecks(db, { supporterIds: [first] })).toEqual(NONE)
      const second = await add({ phone })
      expect(await runFlagChecks(db, { supporterIds: [second] })).toMatchObject({ duplicate_phone: 1 })
      const ids = await flaggedIds('duplicate_phone')
      expect([ids.has(first), ids.has(second)]).toEqual([false, true])
      const [flag] = await db.select().from(flags).where(eq(flags.supporterId, second))
      expect(flag!.details).toEqual({ uses: 2, samePu: true, sharedPhone: false })
    })

    it(`gps_cluster needs ${GPS_CLUSTER_MIN} identical fixes from one lead`, async () => {
      const gps = { lat: puLocation.lat + 0.0007, lng: puLocation.lng + 0.0007, accuracyM: 8 }
      const ids: string[] = []
      for (let i = 0; i < GPS_CLUSTER_MIN - 1; i++) ids.push(await add({ kmNorth: null, gps }))
      expect(await runFlagChecks(db, { supporterIds: ids })).toMatchObject({ gps_cluster: 0 })
      ids.push(await add({ kmNorth: null, gps }))
      expect(await runFlagChecks(db, { supporterIds: ids.slice(-1) })).toMatchObject({ gps_cluster: GPS_CLUSTER_MIN })
    })
  })

  describe('reviewed flags', () => {
    it('a dismissed supporter flag is not raised again', async () => {
      await runFlagChecks(db) // anything still pending from the cases above
      const dismissed = new Set((await dismiss('gps_far').returning({ id: flags.supporterId })).map(r => r.id))
      expect(dismissed.size).toBeGreaterThan(0)
      expect(await runFlagChecks(db)).toMatchObject({ gps_far: 0 })
      const open = await db.select().from(flags).where(and(eq(flags.type, 'gps_far'), eq(flags.status, 'open')))
      expect(open.filter(f => dismissed.has(f.supporterId))).toEqual([])
    })

    it('pu_over_capacity comes back only when the registered-voter figure changes', async () => {
      await dismiss('pu_over_capacity')
      expect(await runFlagChecks(db)).toMatchObject({ pu_over_capacity: 0 })
      await db.update(units).set({ registeredVoters: sql`registered_voters - 1` }).where(eq(units.code, patterns.overCapacityPu))
      expect(await runFlagChecks(db)).toMatchObject({ pu_over_capacity: 1 })
    })

    it('rate_anomaly comes back only for a burst after the reviewed one', async () => {
      await dismiss('rate_anomaly')
      expect(await runFlagChecks(db)).toMatchObject({ rate_anomaly: 0 })

      // A new burst today (the planted one was in September): one capture a minute… flagged again.
      const start = Date.now() - 50 * 60_000
      const ids: string[] = []
      for (let i = 0; i <= RATE_ANOMALY_PER_HOUR; i++) {
        const at = new Date(start + i * 45_000).toISOString()
        ids.push(await add({ capturedAt: at, consentAt: at, kmNorth: null }))
      }
      expect(await runFlagChecks(db, { supporterIds: ids })).toMatchObject({ rate_anomaly: 1 })
      const [open] = await db.select().from(flags).where(and(eq(flags.type, 'rate_anomaly'), eq(flags.status, 'open')))
      expect(open).toMatchObject({ userId: puLead.id, puCode: PU })
    })

    it('PUs without a reported figure are never checked for capacity', async () => {
      const busy = '19/01/01/002'
      await db.update(units).set({ registeredVoters: null }).where(eq(units.code, busy))
      expect(await runFlagChecks(db)).toMatchObject({ pu_over_capacity: 0 })
      await db.update(units).set({ registeredVoters: 1 }).where(eq(units.code, busy))
      expect(await runFlagChecks(db)).toMatchObject({ pu_over_capacity: 1 })
      const [stats] = await db.select().from(puStats).where(eq(puStats.puCode, busy))
      expect(stats!.flaggedOpen).toBeGreaterThanOrEqual(1)
    })
  })
})
