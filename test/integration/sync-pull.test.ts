// Task 4.3: GET /api/sync/pull's service. Scope (own PU / own ward only, nobody above), full records, tombstones for
// anonymised supporters, the cursor (every record once, in order) and `since` (the overlap never misses a write).
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { supporters, users } from '../../server/db/schema'
import { createSupporter } from '../../server/services/supporters'
import { pullForCaller } from '../../server/services/sync'
import { seedDev } from '../../scripts/seed/run'
import { PULL_OVERLAP_MS } from '../../shared/constants/sync'
import { syncPullQuerySchema } from '../../shared/schemas/sync'
import type { SessionUser } from '../../shared/types/auth'
import type { SupporterInput } from '../../shared/types/supporter'
import type { PullResponse } from '../../shared/types/sync'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const PU = '19/01/01/001'
const WARD = '19/01/01'
const query = (q: Record<string, unknown> = {}) => syncPullQuerySchema.parse(q)
let phoneSeq = 0
const input = (over: Partial<SupporterInput> = {}): SupporterInput => ({
  id: newId(),
  puCode: PU,
  fullName: 'Pull Test',
  phone: `+23480399${String(5000 + phoneSeq++).padStart(5, '0')}`,
  sharedPhone: false,
  address: null,
  gender: null,
  ageBand: null,
  supportLevel: 'strong',
  hasPvc: 'yes',
  volunteer: false,
  consentAt: '2026-10-07T08:00:00.000Z',
  consentVersion: 'c1-ha',
  consentLanguage: 'ha',
  gps: null,
  capturedAt: '2026-10-07T08:00:01.000Z',
  deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
  ...over,
})

describe.skipIf(!dbAvailable)('sync pull', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const who: Record<string, SessionUser> = {}

  const asCaller = async (phone: string): Promise<SessionUser> => {
    const [u] = await db.select().from(users).where(eq(users.phone, phone))
    return { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
  }
  const pull = async (caller: SessionUser, q: Record<string, unknown> = {}, limit?: number): Promise<PullResponse> => {
    const r = await pullForCaller(db, caller, query(q), limit)
    if (r.kind !== 'ok') throw new Error(r.kind)
    return r.body
  }
  const pullEverything = async (caller: SessionUser, since?: string, limit?: number) => {
    const pages: PullResponse[] = []
    let cursor: string | undefined
    do {
      const p = await pull(caller, { since, cursor }, limit)
      pages.push(p)
      cursor = p.nextCursor ?? undefined
    } while (cursor)
    return pages
  }
  const countIn = async (unit: string) => {
    const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from supporters where pu_code = ${unit} or pu_code like ${`${unit}/%`}`)
    return row!.n
  }

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
    who.kanoWard = await asCaller('+2348000000103')
    who.kanoPu = await asCaller('+2348000000104')
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('a PU lead gets their own PU only, in full, with the PU as the unit subtree and its totals', async () => {
    const pages = await pullEverything(who.kanoPu!)
    const records = pages.flatMap(p => p.supporters)
    expect(records.length).toBe(await countIn(PU))
    expect(records.every(s => !('deleted' in s) && s.puCode === PU && s.masked === false && /^\+234/.test(s.phone ?? ''))).toBe(true)
    expect(pages[0]!.units.map(u => u.code)).toEqual([PU])
    expect(pages[0]!.stats.total).toBe(records.length)
    expect(pages[0]!.announcements).toEqual([])
  })

  it('a ward lead gets their ward: its PUs\' supporters, the ward and its PUs', async () => {
    const pages = await pullEverything(who.kanoWard!)
    const records = pages.flatMap(p => p.supporters)
    expect(records.length).toBe(await countIn(WARD))
    expect(records.every(s => !('deleted' in s) && s.puCode.startsWith(`${WARD}/`))).toBe(true)
    const units = pages[0]!.units
    expect(units[0]!.code).toBe(WARD)
    expect(units.length).toBeGreaterThan(1)
    expect(units.every(u => u.code === WARD || u.parentCode === WARD)).toBe(true)
  })

  it('nobody above ward pulls (they never hold supporter records offline)', async () => {
    for (const caller of [who.kanoLga!, who.dg!, who.admin!]) {
      expect(await pullForCaller(db, caller, query())).toEqual({ kind: 'forbidden' })
    }
  })

  it('pages return every record exactly once, oldest change first; units only on the first page', async () => {
    const pages = await pullEverything(who.kanoWard!, undefined, 37)
    expect(pages.length).toBeGreaterThan(2)
    const ids = pages.flatMap(p => p.supporters.map(s => s.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(await countIn(WARD))
    expect(pages.slice(1).every(p => p.units.length === 0)).toBe(true)
    const times = pages.flatMap(p => p.supporters.map(s => ('deleted' in s ? 0 : Date.parse(s.updatedAt))))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('since returns what changed after the last pull; serverTime sits PULL_OVERLAP_MS back', async () => {
    // The seed wrote everything seconds ago, inside the overlap: move it an hour back.
    await db.execute(sql`update supporters set updated_at = updated_at - interval '1 hour' where pu_code = ${PU}`)
    const before = Date.now()
    const first = await pull(who.kanoPu!)
    expect(Date.parse(first.serverTime)).toBeLessThanOrEqual(before - PULL_OVERLAP_MS + 5_000)

    const created = await createSupporter(db, who.kanoPu!, input())
    if (created.kind !== 'accepted') throw new Error(created.kind)
    const next = await pullEverything(who.kanoPu!, first.serverTime)
    const ids = next.flatMap(p => p.supporters.map(s => s.id))
    expect(ids).toContain(created.supporter.id)
    expect(ids.length).toBeLessThan(await countIn(PU)) // not everything again
  })

  it('anonymised supporters come back as tombstones, without their data', async () => {
    const created = await createSupporter(db, who.kanoPu!, input())
    if (created.kind !== 'accepted') throw new Error(created.kind)
    const since = (await pull(who.kanoPu!)).serverTime
    await db.update(supporters)
      .set({ status: 'anonymised', phone: null, address: null, gps: null, fullName: '—', updatedAt: sql`now()` })
      .where(eq(supporters.id, created.supporter.id))
    const records = (await pullEverything(who.kanoPu!, since)).flatMap(p => p.supporters)
    expect(records.find(s => s.id === created.supporter.id)).toEqual({ id: created.supporter.id, deleted: true })
  })

  it('rejects a malformed cursor or since', () => {
    expect(syncPullQuerySchema.safeParse({ cursor: 'nope' }).success).toBe(false)
    expect(syncPullQuerySchema.safeParse({ since: 'yesterday' }).success).toBe(false)
  })
})
