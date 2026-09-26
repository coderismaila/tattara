import { desc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, puStats, supporters, units, users } from '../../server/db/schema'
import { createSupporter, getSupporter, recomputePuStats, updateSupporter } from '../../server/services/supporters'
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
  deviceId: 'device-test',
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
      expect(await createSupporter(db, who.kanoPu!, input({ consentVersion: '  ' }))).toEqual({ kind: 'rejected', reason: 'no_consent' })
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
