import { desc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, puStats, supporters, units, users } from '../../server/db/schema'
import { checkPhone, createSupporter, getSupporter, pushSupporters, recomputePuStats, updateSupporter } from '../../server/services/supporters'
import { seedDev } from '../../scripts/seed/run'
import type { SessionUser } from '../../shared/types/auth'
import type { SupporterInput } from '../../shared/types/supporter'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const PU = '19/01/01/001'
let phoneSeq = 0
const newPhone = () => `+23480377${String(++phoneSeq).padStart(5, '0')}`

const input = (over: Partial<SupporterInput> = {}): SupporterInput => ({
  id: newId(),
  puCode: PU,
  fullName: 'Musa Garba',
  phone: newPhone(),
  sharedPhone: false,
  address: ' Kusa da masallaci ',
  gender: 'male',
  ageBand: '25_34',
  supportLevel: 'strong',
  hasPvc: 'yes',
  volunteer: false,
  consentAt: '2026-09-26T08:00:00.000Z',
  consentVersion: 'c1-ha',
  consentLanguage: 'ha',
  gps: { lat: 12.0, lng: 8.52, accuracyM: 12.4 },
  capturedAt: '2026-09-26T08:00:05.000Z',
  deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
  ...over,
})

describe.skipIf(!dbAvailable)('supporters service', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const who: Record<string, SessionUser> = {}

  const asCaller = async (phone: string): Promise<SessionUser> => {
    const [u] = await db.select().from(users).where(eq(users.phone, phone))
    return { id: u!.id, role: u!.role, unitCode: u!.unitCode, sessionVersion: u!.sessionVersion }
  }
  const stats = async (pu = PU) => (await db.select().from(puStats).where(eq(puStats.puCode, pu)))[0]
  const expectStatsMatchRecompute = async () => {
    const incremental = await db.select().from(puStats).where(sql`${puStats.puCode} like '19/%'`).orderBy(puStats.puCode)
    await db.transaction(tx => recomputePuStats(tx, '19'))
    const rebuilt = await db.select().from(puStats).where(sql`${puStats.puCode} like '19/%'`).orderBy(puStats.puCode)
    const strip = (rows: typeof incremental) => rows.map(({ updatedAt: _u, ...r }) => r)
    expect(strip(incremental)).toEqual(strip(rebuilt))
  }

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()
    who.dg = await asCaller('+2348000000002')
    who.kanoWard = await asCaller('+2348000000103')
    who.kanoPu = await asCaller('+2348000000104') // 19/01/01/001
    who.katsinaPu = await asCaller('+2348000000204')
    who.katsinaWard = await asCaller('+2348000000203')
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('createSupporter', () => {
    it('accepts a capture on the lead\'s own PU and counts it in pu_stats', async () => {
      const before = await stats()
      const r = await createSupporter(db, who.kanoPu!, input())
      if (r.kind !== 'accepted') throw new Error(r.kind)
      expect(r.supporter).toMatchObject({ puCode: PU, capturedBy: who.kanoPu!.id, address: 'Kusa da masallaci', gpsAccuracyM: 12, verification: 'unverified', status: 'active' })
      const after = await stats()
      expect(after!.total).toBe(before!.total + 1)
      expect(after!.male).toBe(before!.male + 1)
      expect(after!.lastCaptureAt!.getTime()).toBeGreaterThanOrEqual(new Date('2026-09-26T08:00:05Z').getTime())
    })

    it('is idempotent by id: the same capture again is a duplicate and is not counted twice', async () => {
      const capture = input()
      expect((await createSupporter(db, who.kanoPu!, capture)).kind).toBe('accepted')
      const total = (await stats())!.total
      expect(await createSupporter(db, who.kanoPu!, capture)).toMatchObject({ kind: 'duplicate', supporter: { id: capture.id } })
      expect((await stats())!.total).toBe(total)
    })

    it('an id already used by someone else is a conflict', async () => {
      const capture = input()
      await createSupporter(db, who.kanoPu!, capture)
      expect(await createSupporter(db, who.katsinaPu!, { ...capture, puCode: '20/01/01/001' })).toEqual({ kind: 'conflict' })
    })

    it.each([
      ['another PU', 'kanoPu', { puCode: '19/01/01/002' }],
      ['a ward lead', 'kanoWard', {}],
      ['the DG', 'dg', {}],
      ['a ward code', 'kanoPu', { puCode: '19/01/01' }],
    ] as const)('rejects a capture by or for %s as out_of_scope', async (_label, caller, over) => {
      expect(await createSupporter(db, who[caller]!, input(over))).toEqual({ kind: 'rejected', reason: 'out_of_scope' })
    })

    it('rejects missing consent, bad ids and bad phones', async () => {
      expect(await createSupporter(db, who.kanoPu!, input({ consentVersion: '  ' as never }))).toEqual({ kind: 'rejected', reason: 'no_consent' })
      expect(await createSupporter(db, who.kanoPu!, input({ consentAt: 'not a date' }))).toEqual({ kind: 'rejected', reason: 'no_consent' })
      expect(await createSupporter(db, who.kanoPu!, input({ id: crypto.randomUUID() }))).toEqual({ kind: 'rejected', reason: 'invalid' })
      expect(await createSupporter(db, who.kanoPu!, input({ phone: '08031234567' }))).toEqual({ kind: 'rejected', reason: 'invalid' })
    })

    it('rejects captures on an inactive PU', async () => {
      await db.update(units).set({ active: false }).where(eq(units.code, PU))
      try {
        expect(await createSupporter(db, who.kanoPu!, input())).toEqual({ kind: 'rejected', reason: 'pu_inactive' })
      }
      finally {
        await db.update(units).set({ active: true }).where(eq(units.code, PU))
      }
    })
  })

  describe('updateSupporter', () => {
    it('applies editable fields, moves pu_stats buckets and audits field names only', async () => {
      const created = await createSupporter(db, who.kanoPu!, input())
      if (created.kind !== 'accepted') throw new Error(created.kind)
      const before = (await stats())!
      const phone = newPhone()

      const r = await updateSupporter(db, who.kanoPu!, created.supporter.id, { gender: 'female', supportLevel: 'leaning', phone, fullName: 'Musa Garba' })
      if (r.kind !== 'ok') throw new Error(r.kind)
      expect(r.changed.sort()).toEqual(['gender', 'phone', 'supportLevel'])
      expect(r.supporter.updatedAt.getTime()).toBeGreaterThan(created.supporter.updatedAt.getTime())
      expect(r.supporter.updatedBy).toBe(who.kanoPu!.id)

      const after = (await stats())!
      expect([after.total, after.male, after.female, after.strong, after.leaning])
        .toEqual([before.total, before.male - 1, before.female + 1, before.strong - 1, before.leaning + 1])

      const [entry] = await db.select().from(auditLog).where(eq(auditLog.targetId, created.supporter.id)).orderBy(desc(auditLog.id))
      expect(entry).toMatchObject({ action: 'supporter.update', scopeCode: PU, meta: { fields: expect.arrayContaining(['phone']) } })
      expect(JSON.stringify(entry!.meta)).not.toContain(phone.slice(4))
    })

    it('ignores fields that cannot be edited', async () => {
      const created = await createSupporter(db, who.kanoPu!, input())
      if (created.kind !== 'accepted') throw new Error(created.kind)
      const patch = { puCode: '19/01/01/002', consentVersion: 'x', volunteer: true } as never
      const r = await updateSupporter(db, who.kanoPu!, created.supporter.id, patch)
      expect(r).toMatchObject({ kind: 'ok', changed: ['volunteer'], supporter: { puCode: PU, consentVersion: 'c1-ha' } })
    })

    it('only the PU lead of the supporter\'s PU may edit; unknown ids look the same', async () => {
      const created = await createSupporter(db, who.kanoPu!, input())
      if (created.kind !== 'accepted') throw new Error(created.kind)
      for (const caller of [who.kanoWard!, who.katsinaPu!, who.dg!]) {
        expect(await updateSupporter(db, caller, created.supporter.id, { volunteer: true })).toEqual({ kind: 'forbidden' })
      }
      expect(await updateSupporter(db, who.kanoPu!, newId(), { volunteer: true })).toEqual({ kind: 'forbidden' })
      expect(await updateSupporter(db, who.kanoPu!, created.supporter.id, { phone: '0803' })).toEqual({ kind: 'invalid' })
    })

    it('refuses to edit an anonymised record', async () => {
      const created = await createSupporter(db, who.kanoPu!, input())
      if (created.kind !== 'accepted') throw new Error(created.kind)
      await db.update(supporters).set({ status: 'anonymised', fullName: '—', phone: null, address: null, gps: null }).where(eq(supporters.id, created.supporter.id))
      expect(await updateSupporter(db, who.kanoPu!, created.supporter.id, { volunteer: true })).toEqual({ kind: 'anonymised' })
    })
  })

  it('getSupporter: PU lead and ward lead in scope; nobody else', async () => {
    const created = await createSupporter(db, who.kanoPu!, input())
    if (created.kind !== 'accepted') throw new Error(created.kind)
    const id = created.supporter.id
    expect((await getSupporter(db, who.kanoPu!, id))?.id).toBe(id)
    expect((await getSupporter(db, who.kanoWard!, id))?.id).toBe(id)
    expect(await getSupporter(db, who.katsinaWard!, id)).toBeNull()
    expect(await getSupporter(db, who.dg!, id)).toBeNull()
  })

  describe('pushSupporters', () => {
    it('handles each item on its own and answers in order', async () => {
      const good = input()
      await createSupporter(db, who.kanoPu!, good)
      const fresh = input()
      const noConsent = { ...input(), consentVersion: 'c9-ha' }
      const junk = { id: 'not-an-id', fullName: 'X' }
      const elsewhere = input({ puCode: '19/01/01/002' })

      const results = await pushSupporters(db, who.kanoPu!, [fresh, good, noConsent, junk, elsewhere, null])
      expect(results.map(r => [r.result, 'reason' in r ? r.reason : null])).toEqual([
        ['accepted', null],
        ['duplicate', null],
        ['rejected', 'no_consent'],
        ['rejected', 'invalid'],
        ['rejected', 'out_of_scope'],
        ['rejected', 'invalid'],
      ])
      expect(results[0]).toMatchObject({ id: fresh.id, serverUpdatedAt: expect.any(String) })
      expect(results[2]!.id).toBe(noConsent.id)
      expect(results[3]!.id).toBeNull()
    })

    it('reports issues as i18n keys and paths, never the submitted values', async () => {
      const bad = input({ fullName: 'M', phone: 'call 08031234567' as never })
      const [r] = await pushSupporters(db, who.kanoPu!, [bad])
      expect(r).toMatchObject({ result: 'rejected', reason: 'invalid' })
      const issues = (r as { issues: { path: string, message: string }[] }).issues
      expect(issues).toEqual(expect.arrayContaining([
        { path: 'fullName', message: 'supporter.errors.nameRequired' },
        { path: 'phone', message: 'auth.errors.phoneInvalid' },
      ]))
      expect(JSON.stringify(r)).not.toContain('08031234567')
    })
  })

  describe('shared phones (max 3 per number, PRD R-5)', () => {
    it('accepts up to 3 supporters on one number, shared tick or not, and refuses the 4th', async () => {
      const phone = newPhone()
      expect((await createSupporter(db, who.kanoPu!, input({ phone }))).kind).toBe('accepted')
      expect((await createSupporter(db, who.kanoPu!, input({ phone }))).kind).toBe('accepted') // no tick: flagged later (5.1)
      expect((await createSupporter(db, who.kanoPu!, input({ phone, sharedPhone: true }))).kind).toBe('accepted')
      expect(await createSupporter(db, who.kanoPu!, input({ phone, sharedPhone: true }))).toEqual({ kind: 'rejected', reason: 'phone_limit' })
    })

    it('a re-sent record is still a duplicate, not phone_limit', async () => {
      const phone = newPhone()
      const first = input({ phone })
      await createSupporter(db, who.kanoPu!, first)
      await createSupporter(db, who.kanoPu!, input({ phone }))
      await createSupporter(db, who.kanoPu!, input({ phone }))
      expect(await createSupporter(db, who.kanoPu!, first)).toMatchObject({ kind: 'duplicate' })
    })

    it('never lets concurrent captures pass the limit', async () => {
      const phone = newPhone()
      const results = await Promise.all(Array.from({ length: 5 }, () => createSupporter(db, who.kanoPu!, input({ phone, sharedPhone: true }))))
      expect(results.filter(r => r.kind === 'accepted')).toHaveLength(3)
      expect(results.filter(r => r.kind === 'rejected' && r.reason === 'phone_limit')).toHaveLength(2)
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(supporters).where(eq(supporters.phone, phone))
      expect(row!.n).toBe(3)
    })

    it('anonymised records free their number', async () => {
      const phone = newPhone()
      const ids: string[] = []
      for (let i = 0; i < 3; i++) {
        const r = await createSupporter(db, who.kanoPu!, input({ phone }))
        if (r.kind !== 'accepted') throw new Error(r.kind)
        ids.push(r.supporter.id)
      }
      await db.update(supporters).set({ status: 'anonymised', fullName: '—', phone: null, address: null, gps: null }).where(eq(supporters.id, ids[0]!))
      expect((await createSupporter(db, who.kanoPu!, input({ phone }))).kind).toBe('accepted')
    })

    it('an edit cannot move a supporter onto a full number; keeping its own number is fine', async () => {
      const full = newPhone()
      for (let i = 0; i < 3; i++) await createSupporter(db, who.kanoPu!, input({ phone: full }))
      const other = await createSupporter(db, who.kanoPu!, input())
      if (other.kind !== 'accepted') throw new Error(other.kind)
      expect(await updateSupporter(db, who.kanoPu!, other.supporter.id, { phone: full })).toEqual({ kind: 'phone_limit' })

      const [one] = await db.select().from(supporters).where(eq(supporters.phone, full)).limit(1)
      expect(await updateSupporter(db, who.kanoPu!, one!.id, { phone: full, volunteer: true })).toMatchObject({ kind: 'ok', changed: ['volunteer'] })
    })

    it('push reports phone_limit per item', async () => {
      const phone = newPhone()
      const items = Array.from({ length: 4 }, () => input({ phone, sharedPhone: true }))
      const results = await pushSupporters(db, who.kanoPu!, items)
      expect(results.map(r => r.result === 'rejected' ? r.reason : r.result)).toEqual(['accepted', 'accepted', 'accepted', 'phone_limit'])
    })
  })

  describe('checkPhone', () => {
    it('counts uses anywhere and says whether any are on the caller PU, without identifying anyone', async () => {
      const phone = newPhone()
      expect(await checkPhone(db, who.kanoPu!, phone)).toEqual({ countInSystem: 0, samePu: false, limitReached: false })

      await createSupporter(db, who.katsinaPu!, input({ phone, puCode: '20/01/01/001' }))
      expect(await checkPhone(db, who.kanoPu!, phone)).toEqual({ countInSystem: 1, samePu: false, limitReached: false })

      await createSupporter(db, who.kanoPu!, input({ phone }))
      await createSupporter(db, who.kanoPu!, input({ phone }))
      expect(await checkPhone(db, who.kanoPu!, phone)).toEqual({ countInSystem: 3, samePu: true, limitReached: true })
    })

    it('is for PU leads only', async () => {
      for (const caller of [who.kanoWard!, who.dg!]) expect(await checkPhone(db, caller, newPhone())).toBeNull()
    })
  })

  it('incremental pu_stats equal a full recompute', async () => {
    await expectStatsMatchRecompute()
  })

  describe('database CHECKs', () => {
    const raw = async (over: Record<string, unknown>) => {
      const base = { ...input(), ...over }
      const { gps: _gps, ...rest } = base as SupporterInput & Record<string, unknown>
      return db.insert(supporters).values({
        ...rest,
        consentAt: base.consentAt === null ? null : new Date(base.consentAt as string),
        capturedAt: new Date(base.capturedAt as string),
        capturedBy: who.kanoPu!.id,
      } as never)
    }

    it.each([
      ['a non-v7 id', { id: crypto.randomUUID() }, 'supporters_id_uuid_v7'],
      ['a ward code', { puCode: '19/01/01' }, 'supporters_pu_code_is_pu'],
      ['a local phone', { phone: '08031234567' }, 'supporters_phone'],
      ['no phone while active', { phone: null }, 'supporters_phone'],
      ['anonymised with a phone', { status: 'anonymised' }, 'supporters_phone'],
      ['a blank name', { fullName: '  ' }, 'supporters_full_name_length'],
      ['a 201-char address', { address: 'x'.repeat(201) }, 'supporters_address_length'],
      ['a blank consent version', { consentVersion: ' ' }, 'supporters_consent_version'],
    ])('rejects %s', async (_label, over, constraint) => {
      await expect(raw(over)).rejects.toMatchObject({ cause: { constraint_name: constraint } })
    })

    it('rejects a record without consent at the database too', async () => {
      await expect(raw({ consentAt: null })).rejects.toThrow()
    })
  })
})
