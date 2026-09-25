import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { unitTargets, units, type NewUnit } from '../../server/db/schema'
import { normaliseName } from '../../shared/utils/text'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

function unit(code: string, level: NewUnit['level'], parentCode: string | null, extra: Partial<NewUnit> = {}): NewUnit {
  const name = extra.name ?? `UNIT ${code}`
  return { code, level, parentCode, name, nameNormalised: normaliseName(name), sourceVersion: 'test', ...extra }
}

/** Postgres error code of a rejected insert (23514 check, 23503 FK, 23505 unique, 22P02 bad enum). */
async function pgErrorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
    return undefined
  }
  catch (e) {
    // Drizzle wraps driver errors; the Postgres code is on the error or its cause.
    const err = e as { code?: string, cause?: { code?: string } }
    return err.cause?.code ?? err.code
  }
}

describe.skipIf(!dbAvailable)('units schema', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    const conn = createDb(temp.url, { max: 2 })
    db = conn.db
    close = () => conn.client.end()

    await db.insert(units).values([
      unit('19', 'state', null, { name: 'KANO' }),
      unit('19/05', 'lga', '19', { name: 'NASSARAWA' }),
      unit('19/05/03', 'ward', '19/05', { name: 'GAMA' }),
      unit('19/05/03/012', 'pu', '19/05/03', {
        name: 'KOFAR GABAS PRI. SCH.',
        registeredVoters: 812,
        location: { lng: 8.5123, lat: 12.0012 },
      }),
    ])
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('stores a state → LGA → ward → PU chain and round-trips the location', async () => {
    const [pu] = await db.select().from(units).where(eq(units.code, '19/05/03/012'))
    expect(pu).toMatchObject({
      level: 'pu',
      parentCode: '19/05/03',
      nameNormalised: 'kofar gabas pri sch',
      registeredVoters: 812,
      locationEstimated: false,
      active: true,
    })
    expect(pu!.location).toEqual({ lng: 8.5123, lat: 12.0012 })
    expect(pu!.createdAt).toBeInstanceOf(Date)
  })

  it.each([
    ['unpadded state', unit('9', 'state', null)],
    ['state with a parent', unit('20', 'state', '19')],
    ['LGA code at state level', unit('19/06', 'state', null)],
    ['state code at LGA level', unit('21', 'lga', null)],
    ['LGA without parent', unit('19/06', 'lga', null)],
    ['LGA under the wrong state', unit('19/06', 'lga', '20')],
    ['ward skipping its LGA', unit('19/05/04', 'ward', '19')],
    ['PU with 2-digit number', unit('19/05/03/13', 'pu', '19/05/03')],
    ['PU with letters', unit('19/05/03/01A', 'pu', '19/05/03')],
    ['blank name', unit('19/07', 'lga', '19', { name: '   ' })],
    ['negative voters', unit('19/05/03/014', 'pu', '19/05/03', { registeredVoters: -1 })],
  ])('rejects %s (check constraint)', async (_label, row) => {
    expect(await pgErrorCode(db.insert(units).values(row))).toBe('23514')
  })

  it('rejects orphans (parent must exist)', async () => {
    // Well-formed ward whose LGA 19/09 was never inserted.
    expect(await pgErrorCode(db.insert(units).values(unit('19/09/01', 'ward', '19/09')))).toBe('23503')
  })

  it('rejects duplicate codes', async () => {
    expect(await pgErrorCode(db.insert(units).values(unit('19/05', 'lga', '19')))).toBe('23505')
  })

  it('accepts targets for existing units and rejects bad ones', async () => {
    await db.insert(unitTargets).values({ unitCode: '19/05', target: 25000 })
    const [row] = await db.select().from(unitTargets).where(eq(unitTargets.unitCode, '19/05'))
    expect(row).toMatchObject({ target: 25000, setBy: null })

    expect(await pgErrorCode(db.insert(unitTargets).values({ unitCode: '19/05/03', target: -5 }))).toBe('23514')
    expect(await pgErrorCode(db.insert(unitTargets).values({ unitCode: '99', target: 5 }))).toBe('23503')
  })

  it('scope prefix queries can use the text_pattern_ops index', async () => {
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`)
      return tx.execute<{ 'QUERY PLAN': string }>(sql`explain select code from units where code like '19/05/%'`)
    })
    const text = plan.map(r => r['QUERY PLAN']).join('\n')
    expect(text).toContain('units_code_prefix_idx')
  })

  it('supports metre-based distance queries on location', async () => {
    // ~1.1 km north of the PU.
    const near = await db.select({ code: units.code }).from(units)
      .where(sql`ST_DWithin(${units.location}, ST_SetSRID(ST_MakePoint(8.5123, 12.0112), 4326)::geography, 1500)`)
    const far = await db.select({ code: units.code }).from(units)
      .where(sql`ST_DWithin(${units.location}, ST_SetSRID(ST_MakePoint(8.5123, 12.0112), 4326)::geography, 1000)`)
    expect(near.map(r => r.code)).toEqual(['19/05/03/012'])
    expect(far).toEqual([])
  })
})
