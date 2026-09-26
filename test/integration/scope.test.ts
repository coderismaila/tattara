import { asc, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, units, users } from '../../server/db/schema'
import { AuditPiiError, recordAudit } from '../../server/utils/audit'
import { scopeForUser, scopeWhere } from '../../server/utils/scope'
import type { Role } from '../../shared/constants/roles'
import { normaliseName } from '../../shared/utils/text'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const CODES = [
  '19', '19/05', '19/05/03', '19/05/03/012', '19/05/03/013', '19/05/04', '19/05/04/001',
  '19/06', '19/06/01', '19/06/01/001', '20', '20/05', '20/05/03', '20/05/03/012',
]
const level = (c: string) => (['state', 'lga', 'ward', 'pu'] as const)[c.split('/').length - 1]!

describe.skipIf(!dbAvailable)('scopeWhere on real rows, and audit writes', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  const inScope = async (role: Role, unitCode: string | null, allowAdmin = false) =>
    (await db.select({ code: units.code }).from(units)
      .where(scopeWhere(units.code, scopeForUser({ role, unitCode }), { allowAdmin }))
      .orderBy(asc(units.code))).map(r => r.code)

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    const conn = createDb(temp.url, { max: 2 })
    db = conn.db
    close = () => conn.client.end()
    await db.insert(units).values(CODES.map(code => ({
      code,
      level: level(code),
      parentCode: code.includes('/') ? code.slice(0, code.lastIndexOf('/')) : null,
      name: `U ${code}`,
      nameNormalised: normaliseName(`U ${code}`),
      sourceVersion: 'test',
    })))
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('returns exactly the unit and its descendants', async () => {
    expect(await inScope('LGA_LEAD', '19/05')).toEqual(['19/05', '19/05/03', '19/05/03/012', '19/05/03/013', '19/05/04', '19/05/04/001'])
    expect(await inScope('WARD_LEAD', '19/05/03')).toEqual(['19/05/03', '19/05/03/012', '19/05/03/013'])
    expect(await inScope('PU_LEAD', '19/05/03/012')).toEqual(['19/05/03/012'])
    expect(await inScope('STATE_LEAD', '20')).toEqual(['20', '20/05', '20/05/03', '20/05/03/012'])
  })

  it('region scope sees everything; ADMIN sees nothing unless the route opts in', async () => {
    expect(await inScope('DG', null)).toHaveLength(CODES.length)
    expect(await inScope('ADMIN', null)).toEqual([])
    expect(await inScope('ADMIN', null, true)).toHaveLength(CODES.length)
  })

  it('keeps using the text_pattern_ops index with bind parameters on a generic plan', async () => {
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local plan_cache_mode = force_generic_plan`)
      await tx.execute(sql`set local enable_seqscan = off`)
      await tx.execute(sql.raw(`prepare scoped(text, text) as select code from units where code ~>=~ $1 and code ~<~ $2`))
      const rows = await tx.execute<{ 'QUERY PLAN': string }>(sql.raw(`explain execute scoped('19/05', '19/050')`))
      await tx.execute(sql.raw('deallocate scoped'))
      return rows.map(r => r['QUERY PLAN']).join('\n')
    })
    expect(plan).toContain('units_code_prefix_idx')
  })

  it('records audit entries and refuses PII in meta', async () => {
    const [dg] = await db.insert(users).values({
      fullName: 'Test DG',
      phone: '+2348030000002',
      role: 'DG',
      pinHash: 'x',
      status: 'active',
    }).returning()
    const row = await recordAudit(db, { id: dg!.id, role: 'DG', ip: '203.0.113.9' }, {
      action: 'user.invite',
      targetType: 'user',
      targetId: 'abc',
      scopeCode: '19',
      meta: { role: 'STATE_LEAD' },
    })
    expect(row).toMatchObject({ actorId: dg!.id, actorRole: 'DG', ip: '203.0.113.9', action: 'user.invite', meta: { role: 'STATE_LEAD' } })

    await expect(recordAudit(db, { id: null, role: null, ip: null }, { action: 'x', meta: { phone: '+2348031234567' } }))
      .rejects.toBeInstanceOf(AuditPiiError)
    expect(await db.select().from(auditLog)).toHaveLength(1)
  })
})
