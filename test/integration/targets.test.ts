// Task 6.4: setting targets, the proportional split (registered voters, or PU count when figures are missing), preview,
// audit rows, and the targets showing up in the stats.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { auditLog, unitTargets, units, users, type NewUnit } from '../../server/db/schema'
import { distributeTarget, setTarget } from '../../server/services/targets'
import { childrenStats, unitStats } from '../../server/services/stats'
import type { Role } from '../../shared/constants/roles'
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

describe.skipIf(!dbAvailable)('targets', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const callers = {} as Record<'dg' | 'state' | 'lga' | 'ward', { id: string, role: Role, unitCode: string | null }>

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    const conn = createDb(temp.url, { max: 2 })
    db = conn.db
    close = () => conn.client.end()

    await db.insert(units).values([
      unit('19', 'state', null),
      unit('19/01', 'lga', '19'),
      // Ward 01: every PU has a figure. Ward 02: one PU has none. Ward 03 is inactive.
      unit('19/01/01', 'ward', '19/01'),
      unit('19/01/02', 'ward', '19/01'),
      unit('19/01/03', 'ward', '19/01', { active: false }),
      unit('19/01/01/001', 'pu', '19/01/01', { registeredVoters: 300 }),
      unit('19/01/01/002', 'pu', '19/01/01', { registeredVoters: 100 }),
      unit('19/01/01/003', 'pu', '19/01/01', { registeredVoters: 600 }),
      unit('19/01/02/001', 'pu', '19/01/02', { registeredVoters: 1000 }),
      unit('19/01/02/002', 'pu', '19/01/02'),
    ])
    const people: [keyof typeof callers, Role, string | null, NewUnit['level'] | null][] = [
      ['dg', 'DG', null, null], ['state', 'STATE_LEAD', '19', 'state'], ['lga', 'LGA_LEAD', '19/01', 'lga'], ['ward', 'WARD_LEAD', '19/01/01', 'ward'],
    ]
    for (const [key, role, unitCode, unitLevel] of people) {
      const [u] = await db.insert(users).values({
        fullName: `Test ${role}`, phone: `+23480300001${people.findIndex(p => p[0] === key)}0`, role, unitCode, unitLevel, pinHash: 'x', status: 'active',
      }).returning()
      callers[key] = { id: u!.id, role, unitCode }
    }
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action))

  it('lets the DG set a state target and the state lead an LGA target, audited with from/to', async () => {
    expect(await setTarget(db, callers.dg, '19', 50_000)).toEqual({ kind: 'ok', result: { code: '19', target: 50_000, previous: null } })
    expect(await setTarget(db, callers.state, '19/01', 2_000)).toMatchObject({ kind: 'ok', result: { previous: null } })
    expect(await setTarget(db, callers.state, '19/01', 1_800)).toMatchObject({ kind: 'ok', result: { target: 1_800, previous: 2_000 } })

    const [row] = await db.select().from(unitTargets).where(eq(unitTargets.unitCode, '19/01'))
    expect(row).toMatchObject({ target: 1_800, setBy: callers.state.id })
    const set = await audits('target.set')
    expect(set.map(a => a.meta)).toEqual([{ from: null, to: 50_000 }, { from: null, to: 2_000 }, { from: 2_000, to: 1_800 }])
    expect(set[2]).toMatchObject({ actorId: callers.state.id, targetId: '19/01', scopeCode: '19/01' })
  })

  it('refuses the wrong setter and unknown or inactive units', async () => {
    expect((await setTarget(db, callers.dg, '19/01', 5)).kind).toBe('forbidden')
    expect((await setTarget(db, callers.lga, '19/01', 5)).kind).toBe('forbidden')
    expect((await setTarget(db, callers.state, '19/02', 5)).kind).toBe('not_found')
    expect((await setTarget(db, callers.lga, '19/01/03', 5)).kind).toBe('not_found')
    expect((await setTarget(db, callers.state, '19/01', -1)).kind).toBe('invalid')
  })

  it('previews a split by PU count when a PU below has no figure, without saving', async () => {
    const out = await distributeTarget(db, callers.lga, '19/01', true)
    expect(out).toEqual({
      kind: 'ok',
      result: {
        code: '19/01', target: 1_800, basis: 'pu_count', saved: false,
        children: [
          { code: '19/01/01', name: 'UNIT 19/01/01', weight: 3, target: 1_080, previous: null },
          { code: '19/01/02', name: 'UNIT 19/01/02', weight: 2, target: 720, previous: null },
        ],
      },
    })
    expect(await db.select().from(unitTargets).where(eq(unitTargets.unitCode, '19/01/01'))).toEqual([])
    expect(await audits('target.distribute')).toEqual([])
  })

  it('saves the split by registered voters once every PU has a figure, and audits it', async () => {
    await db.update(units).set({ registeredVoters: 1_000 }).where(eq(units.code, '19/01/02/002'))
    const out = await distributeTarget(db, callers.lga, '19/01', false)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.result.basis).toBe('registered_voters')
    expect(out.result.children.map(c => [c.code, c.weight, c.target])).toEqual([['19/01/01', 1_000, 600], ['19/01/02', 2_000, 1_200]])

    const saved = await db.select({ code: unitTargets.unitCode, target: unitTargets.target, setBy: unitTargets.setBy }).from(unitTargets)
    expect(saved.filter(s => s.code.startsWith('19/01/'))).toEqual([
      { code: '19/01/01', target: 600, setBy: callers.lga.id },
      { code: '19/01/02', target: 1_200, setBy: callers.lga.id },
    ])
    const [audit] = await audits('target.distribute')
    expect(audit).toMatchObject({ actorId: callers.lga.id, targetId: '19/01', meta: { target: 1_800, basis: 'registered_voters', children: 2 } })
  })

  it('a second split overwrites the children and reports what they had', async () => {
    await setTarget(db, callers.state, '19/01', 900)
    const out = await distributeTarget(db, callers.lga, '19/01', false)
    expect(out.kind === 'ok' && out.result.children.map(c => [c.target, c.previous])).toEqual([[300, 600], [600, 1_200]])
  })

  it('refuses a unit without a target, without children, or not the caller’s own', async () => {
    expect((await distributeTarget(db, callers.ward, '19/01/01', true)).kind).toBe('ok') // ward 01 got 300 above
    await db.delete(unitTargets).where(eq(unitTargets.unitCode, '19/01/01'))
    expect((await distributeTarget(db, callers.ward, '19/01/01', true)).kind).toBe('no_target')
    expect((await distributeTarget(db, callers.state, '19/01', true)).kind).toBe('forbidden')
    expect((await distributeTarget(db, callers.dg, '19', true)).kind).toBe('forbidden')

    await db.insert(units).values(unit('19/02', 'lga', '19'))
    const [empty] = await db.insert(users).values({
      fullName: 'Empty LGA', phone: '+2348030000990', role: 'LGA_LEAD', unitCode: '19/02', unitLevel: 'lga', pinHash: 'x', status: 'active',
    }).returning()
    await setTarget(db, callers.state, '19/02', 10)
    expect((await distributeTarget(db, { id: empty!.id, role: 'LGA_LEAD', unitCode: '19/02' }, '19/02', true)).kind).toBe('no_children')
  })

  it('the stats show the targets and progress', async () => {
    const lga = await unitStats(db, '19/01')
    expect(lga?.target).toBe(900)
    const kids = await childrenStats(db, '19/01', 'coverage', 'asc')
    expect(kids?.children.find(c => c.code === '19/01/02')).toMatchObject({ target: 600, progress: 0 })
  })
})
