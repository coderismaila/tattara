// Task 5.4 against Postgres: who sees which flags (scope per role, full vs masked supporters, lead and PU subjects),
// filters and paging, and reviews (audited without the note, pu_stats refreshed, a supervisor can overrule).
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, flags, puStats, users } from '../../server/db/schema'
import { listFlags, resolveFlag } from '../../server/services/flag-review'
import { refreshFlaggedOpen } from '../../server/services/flags'
import { createSupporter } from '../../server/services/supporters'
import { seedDev } from '../../scripts/seed/run'
import { flagListQuerySchema } from '../../shared/schemas/flags'
import type { SessionUser } from '../../shared/types/auth'
import type { FlagDto } from '../../shared/types/flags'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const PU = '19/01/01/001'
const query = (q: Record<string, unknown> = {}) => flagListQuerySchema.parse(q)

describe.skipIf(!dbAvailable)('flag review', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const who: Record<string, SessionUser> = {}
  const ids: Record<string, string> = {}

  const asCaller = async (phone: string): Promise<SessionUser> => {
    const [u] = await db.select().from(users).where(eq(users.phone, phone))
    return { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
  }
  const list = async (caller: SessionUser, q: Record<string, unknown> = {}) => {
    const r = await listFlags(db, caller, query(q))
    if (r.kind !== 'ok') throw new Error(r.kind)
    return r.body
  }
  const find = (items: FlagDto[], id: string) => items.find(i => i.id === id)
  const flaggedOpen = async () => (await db.select().from(puStats).where(eq(puStats.puCode, PU)))[0]!.flaggedOpen

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    for (const [key, phone] of Object.entries({
      admin: '+2348000000001', dg: '+2348000000002', state: '+2348000000101', lga: '+2348000000102', ward: '+2348000000103',
      pu: '+2348000000104', katsinaState: '+2348000000201', katsinaLga: '+2348000000202', katsinaWard: '+2348000000203',
    })) who[key] = await asCaller(phone)

    const now = new Date().toISOString()
    const r = await createSupporter(db, who.pu!, {
      id: newId(), puCode: PU, fullName: 'Hadiza Flagged', phone: '+2348039950001', sharedPhone: false, address: null,
      gender: null, ageBand: null, supportLevel: 'strong', hasPvc: 'yes', volunteer: false, consentAt: now, consentVersion: 'c1-ha',
      consentLanguage: 'ha', gps: null, capturedAt: now, deviceId: 'device-flag-review',
    })
    if (r.kind !== 'accepted') throw new Error(r.kind)
    const insert = async (values: typeof flags.$inferInsert) => (await db.insert(flags).values(values).returning())[0]!.id
    ids.supporter = await insert({ supporterId: r.supporter.id, puCode: PU, type: 'gps_far', details: { distanceM: 6200, thresholdM: 3000, accuracyM: 10, puLocationEstimated: false } })
    ids.lead = await insert({ userId: who.pu!.id, puCode: PU, type: 'opt_out_spike', details: { optOuts: 6, supporters: 40, days: 7 } })
    ids.pu = await insert({ puCode: '19/01/01/002', type: 'callback_failed', details: { outcome: 'denies' } })
    await refreshFlaggedOpen(db, [PU, '19/01/01/002']) // as the engine does after raising flags
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('listing', () => {
    it('the ward lead sees the supporter in full, the lead by name, the PU flag as a PU', async () => {
      const { items, openCounts } = await list(who.ward!)
      expect(items.every(i => i.puCode.startsWith('19/01/01/') && i.status === 'open')).toBe(true)
      expect(find(items, ids.supporter!)!.subject).toMatchObject({ kind: 'supporter', supporter: { masked: false, fullName: 'Hadiza Flagged', phone: '+2348039950001' } })
      expect(find(items, ids.lead!)!.subject).toEqual({ kind: 'lead', lead: { id: who.pu!.id, fullName: expect.any(String), unitCode: PU } })
      expect(find(items, ids.pu!)!.subject).toEqual({ kind: 'pu' })
      expect(find(items, ids.supporter!)!.details).toMatchObject({ distanceM: 6200 })
      expect(openCounts.gps_far).toBeGreaterThanOrEqual(1)
    })

    it('LGA, state leads and the DG see the same supporter masked', async () => {
      for (const caller of [who.lga!, who.state!, who.dg!]) {
        const f = find((await list(caller, { unit: '19/01/01' })).items, ids.supporter!)!
        expect(f.subject).toMatchObject({ kind: 'supporter', supporter: { masked: true, initials: 'H. F.' } })
        const json = JSON.stringify(f)
        expect(json).not.toContain('Hadiza')
        expect(json).not.toContain('+2348039950001')
      }
    })

    it('each lead sees only their own unit; PU leads and the admin see none', async () => {
      for (const caller of [who.katsinaWard!, who.katsinaLga!, who.katsinaState!]) {
        const { items } = await list(caller, { limit: 100 })
        expect(items.every(i => i.puCode.startsWith('20/'))).toBe(true)
        expect(find(items, ids.supporter!)).toBeUndefined()
      }
      for (const caller of [who.pu!, who.admin!]) expect(await listFlags(db, caller, query())).toEqual({ kind: 'forbidden' })
      expect(await listFlags(db, who.ward!, query({ unit: '19/01/02' }))).toEqual({ kind: 'forbidden' })
      expect(await listFlags(db, who.katsinaState!, query({ unit: PU }))).toEqual({ kind: 'forbidden' })
    })

    it('filters by type and pages newest first without repeats', async () => {
      expect((await list(who.ward!, { type: 'opt_out_spike' })).items.map(i => i.id)).toEqual([ids.lead])
      const seen: string[] = []
      let cursor: string | undefined
      let lastAt = Infinity
      do {
        const page = await list(who.dg!, { limit: 7, cursor })
        for (const i of page.items) {
          expect(Date.parse(i.createdAt)).toBeLessThanOrEqual(lastAt)
          lastAt = Date.parse(i.createdAt)
          seen.push(i.id)
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor && seen.length < 400)
      expect(new Set(seen).size).toBe(seen.length)
      const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from flags where status = 'open'`) as unknown as [{ n: number }]
      expect(seen.length).toBe(n)
    })
  })

  describe('reviewing', () => {
    it('the ward lead dismisses with a note: pu_stats follows, the audit has no note', async () => {
      const before = await flaggedOpen()
      expect(await resolveFlag(db, who.ward!, ids.supporter!, { status: 'dismissed', note: 'Rally away from the PU' }))
        .toEqual({ kind: 'ok', flag: { id: ids.supporter, status: 'dismissed' } })
      expect(await flaggedOpen()).toBe(before - 1)

      const reviewed = find((await list(who.ward!, { status: 'reviewed' })).items, ids.supporter!)!
      expect(reviewed).toMatchObject({ status: 'dismissed', reviewNote: 'Rally away from the PU', reviewedBy: { fullName: expect.any(String) } })
      expect(find((await list(who.ward!)).items, ids.supporter!)).toBeUndefined()

      const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'flag.resolve'), sql`${auditLog.meta}->>'flagId' = ${ids.supporter}`))
      expect(audit!.meta).toEqual({ flagId: ids.supporter, type: 'gps_far', from: 'open', to: 'dismissed' })
      expect(JSON.stringify(audit)).not.toContain('Rally')
    })

    it('the LGA lead can overrule: the latest review wins', async () => {
      expect(await resolveFlag(db, who.lga!, ids.supporter!, { status: 'confirmed' })).toMatchObject({ kind: 'ok' })
      const [row] = await db.select().from(flags).where(eq(flags.id, ids.supporter!))
      expect(row).toMatchObject({ status: 'confirmed', reviewedBy: who.lga!.id, reviewNote: null })
      expect(await db.select().from(auditLog).where(and(eq(auditLog.action, 'flag.resolve'), sql`${auditLog.meta}->>'flagId' = ${ids.supporter}`))).toHaveLength(2)
    })

    it('out of scope looks like no flag; non-reviewers are refused', async () => {
      expect(await resolveFlag(db, who.katsinaWard!, ids.lead!, { status: 'dismissed' })).toEqual({ kind: 'not_found' })
      expect(await resolveFlag(db, who.dg!, newId(), { status: 'dismissed' })).toEqual({ kind: 'not_found' })
      expect(await resolveFlag(db, who.pu!, ids.lead!, { status: 'dismissed' })).toEqual({ kind: 'forbidden' })
      expect(await resolveFlag(db, who.admin!, ids.lead!, { status: 'dismissed' })).toEqual({ kind: 'forbidden' })
    })
  })
})
