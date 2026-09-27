import { and, desc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, puStats, supporters, users } from '../../server/db/schema'
import { AuditPiiError } from '../../server/services/audit'
import { createSupporter, listSupporters, requestRemoval } from '../../server/services/supporters'
import { seedDev } from '../../scripts/seed/run'
import { supporterListQuerySchema } from '../../shared/schemas/supporter'
import type { SessionUser } from '../../shared/types/auth'
import type { SupporterInput } from '../../shared/types/supporter'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const PU = '19/01/01/001'
const query = (q: Record<string, unknown> = {}) => supporterListQuerySchema.parse(q)
const input = (over: Partial<SupporterInput>): SupporterInput => ({
  id: newId(),
  puCode: PU,
  fullName: 'Test Person',
  phone: '+2348039900001',
  sharedPhone: false,
  address: null,
  gender: null,
  ageBand: null,
  supportLevel: 'strong',
  hasPvc: 'yes',
  volunteer: false,
  consentAt: '2026-09-27T08:00:00.000Z',
  consentVersion: 'c1-ha',
  consentLanguage: 'ha',
  gps: null,
  capturedAt: '2026-09-27T08:00:01.000Z',
  deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
  ...over,
})

describe.skipIf(!dbAvailable)('supporter list, search and removal', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const who: Record<string, SessionUser> = {}
  const ids: Record<string, string> = {}

  const asCaller = async (phone: string): Promise<SessionUser> => {
    const [u] = await db.select().from(users).where(eq(users.phone, phone))
    return { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
  }

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' }) // includes ~5,000 fake supporters on the dev PUs
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    who.admin = await asCaller('+2348000000001')
    who.dg = await asCaller('+2348000000002')
    who.kanoLga = await asCaller('+2348000000102')
    who.kanoWard = await asCaller('+2348000000103')
    who.kanoPu = await asCaller('+2348000000104')
    who.katsinaWard = await asCaller('+2348000000203')

    for (const [key, fullName, phone] of [
      ['zainab', 'Zainabu Ƙwari', '+2348039900111'],
      ['zaid', 'Zaidu Tanko', '+2348039904567'],
      ['percent', 'Aminu 100% Bello', '+2348039900222'],
    ] as const) {
      const r = await createSupporter(db, who.kanoPu!, input({ fullName, phone }))
      if (r.kind !== 'accepted') throw new Error(r.kind)
      ids[key] = r.supporter.id
    }
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('scope', () => {
    it('a PU lead lists only their own PU', async () => {
      const r = await listSupporters(db, who.kanoPu!, query({ limit: 200 }))
      if (r.kind !== 'ok') throw new Error(r.kind)
      expect(r.items.length).toBeGreaterThan(3)
      expect(r.items.every(s => s.puCode === PU)).toBe(true)
      expect(await listSupporters(db, who.kanoPu!, query({ pu: '19/01/01/002' }))).toEqual({ kind: 'forbidden' })
    })

    it('a ward lead lists the whole ward, or one PU in it', async () => {
      const all = await listSupporters(db, who.kanoWard!, query({ limit: 200 }))
      if (all.kind !== 'ok') throw new Error(all.kind)
      expect(new Set(all.items.map(s => s.puCode.slice(0, 8)))).toEqual(new Set(['19/01/01']))
      expect(new Set(all.items.map(s => s.puCode)).size).toBeGreaterThan(1)

      const one = await listSupporters(db, who.kanoWard!, query({ pu: '19/01/01/002', limit: 200 }))
      if (one.kind !== 'ok') throw new Error(one.kind)
      expect(one.items.every(s => s.puCode === '19/01/01/002')).toBe(true)
      expect(await listSupporters(db, who.kanoWard!, query({ pu: '19/01/02/001' }))).toEqual({ kind: 'forbidden' })
    })

    it.each(['kanoLga', 'dg', 'admin'])('%s gets no supporter list', async (key) => {
      expect(await listSupporters(db, who[key]!, query())).toEqual({ kind: 'forbidden' })
    })

    it('another ward\'s lead never sees these supporters', async () => {
      const r = await listSupporters(db, who.katsinaWard!, query({ q: 'Zainabu' }))
      expect(r).toEqual({ kind: 'ok', items: [], nextCursor: null })
    })
  })

  describe('search', () => {
    const names = async (q: string, caller = who.kanoPu!) => {
      const r = await listSupporters(db, caller, query({ q }))
      if (r.kind !== 'ok') throw new Error(r.kind)
      return r.items.map(s => s.fullName)
    }

    it('matches part of a name, ignoring case and hooked-letter capitals', async () => {
      expect(await names('zainab')).toContain('Zainabu Ƙwari')
      // The seeded fake supporters use Ƙwari as a family name too: every hit must contain it, whatever the case.
      const hits = await names('ƙWARI')
      expect(hits).toContain('Zainabu Ƙwari')
      expect(hits.every(n => n.toLowerCase().includes('ƙwari'))).toBe(true)
    })

    it('matches a full phone number in any common format', async () => {
      expect(await names('0803 990 0111')).toEqual(['Zainabu Ƙwari'])
      expect(await names('+2348039900111')).toEqual(['Zainabu Ƙwari'])
    })

    it('matches the last 4+ digits of a phone', async () => {
      expect(await names('4567')).toContain('Zaidu Tanko')
      expect(await names('904567')).toEqual(['Zaidu Tanko'])
    })

    it('treats % and _ in the search as plain text', async () => {
      expect(await names('100%')).toEqual(['Aminu 100% Bello'])
      expect(await names('_')).toEqual([])
    })
  })

  it('pages newest first with a stable cursor, without repeats', async () => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 50; i++) {
      const r = await listSupporters(db, who.kanoWard!, query({ limit: 37, cursor }))
      if (r.kind !== 'ok') throw new Error(r.kind)
      seen.push(...r.items.map(s => s.id))
      if (!r.nextCursor) break
      cursor = r.nextCursor
    }
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toEqual([...seen].sort().reverse())
    const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(supporters)
      .where(sql`${supporters.puCode} like '19/01/01/%' and ${supporters.status} <> 'anonymised'`)
    expect(seen).toHaveLength(total!.n)
  })

  it('leaves anonymised records out', async () => {
    await db.update(supporters).set({ status: 'anonymised', fullName: '—', phone: null, address: null, gps: null }).where(eq(supporters.id, ids.percent!))
    const r = await listSupporters(db, who.kanoPu!, query({ limit: 200 }))
    if (r.kind !== 'ok') throw new Error(r.kind)
    expect(r.items.some(s => s.id === ids.percent)).toBe(false)
    expect(await requestRemoval(db, who.kanoPu!, ids.percent!, 'Asked to be removed')).toEqual({ kind: 'not_found' })
  })

  describe('requestRemoval', () => {
    it('marks the record, keeps it counted, and audits the reason', async () => {
      const [before] = await db.select().from(puStats).where(eq(puStats.puCode, PU))
      const r = await requestRemoval(db, who.kanoWard!, ids.zaid!, 'Asked to be removed at the market')
      expect(r).toMatchObject({ kind: 'ok', supporter: { status: 'removal_requested', updatedBy: who.kanoWard!.id } })
      const [after] = await db.select().from(puStats).where(eq(puStats.puCode, PU))
      expect(after!.total).toBe(before!.total)

      const [entry] = await db.select().from(auditLog)
        .where(and(eq(auditLog.targetId, ids.zaid!), eq(auditLog.action, 'supporter.removal_request'))).orderBy(desc(auditLog.id))
      expect(entry).toMatchObject({ actorId: who.kanoWard!.id, scopeCode: PU, meta: { reason: 'Asked to be removed at the market' } })

      expect(await requestRemoval(db, who.kanoPu!, ids.zaid!, 'Again')).toEqual({ kind: 'already_requested' })
    })

    it('refuses a phone number in the reason', async () => {
      await expect(requestRemoval(db, who.kanoPu!, ids.zainab!, 'Call her on 08031234567')).rejects.toBeInstanceOf(AuditPiiError)
    })

    it('out of scope looks the same as unknown', async () => {
      expect(await requestRemoval(db, who.katsinaWard!, ids.zainab!, 'Not mine')).toEqual({ kind: 'not_found' })
      expect(await requestRemoval(db, who.kanoLga!, ids.zainab!, 'Above ward')).toEqual({ kind: 'not_found' })
      expect(await requestRemoval(db, who.kanoPu!, newId(), 'Unknown id')).toEqual({ kind: 'not_found' })
    })
  })
})
