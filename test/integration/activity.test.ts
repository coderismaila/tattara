// Task 6.5 against Postgres: the leaderboard (last 7 days, progress, coverage; levels; scope) and inactive leads (no
// captures in N days counted from setting up when there are none; invited-but-never-set-up leads; scope).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { invites, supporters, unitTargets, units, users, type NewUnit } from '../../server/db/schema'
import { inactiveLeads, leaderboard } from '../../server/services/activity'
import { recomputePuStats } from '../../server/services/supporters'
import type { Role } from '../../shared/constants/roles'
import { normaliseName } from '../../shared/utils/text'
import { newId } from '../../shared/utils/uuid'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY)

function unit(code: string, level: NewUnit['level'], parentCode: string | null, extra: Partial<NewUnit> = {}): NewUnit {
  const name = extra.name ?? `UNIT ${code}`
  return { code, level, parentCode, name, nameNormalised: normaliseName(name), sourceVersion: 'test', ...extra }
}

describe.skipIf(!dbAvailable)('leaderboard and inactive leads', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const ids: Record<string, string> = {}
  let phoneSeq = 0

  async function lead(key: string, role: Role, unitCode: string, status: 'active' | 'invited' | 'deactivated', createdAt = new Date()) {
    const level = ({ WARD_LEAD: 'ward', PU_LEAD: 'pu' } as const)[role as 'WARD_LEAD' | 'PU_LEAD']
    const [u] = await db.insert(users).values({
      fullName: `Lead ${key}`, phone: `+2348030001${String(phoneSeq++).padStart(3, '0')}`, role, unitCode, unitLevel: level,
      pinHash: status === 'invited' ? null : 'x', status, createdAt,
    }).returning()
    ids[key] = u!.id
  }

  async function capture(puCode: string, by: string, n: number, at: Date) {
    await db.insert(supporters).values(Array.from({ length: n }, () => ({
      id: newId(), puCode, fullName: 'Test Supporter', phone: `+234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
      supportLevel: 'strong' as const, hasPvc: 'yes' as const, consentAt: at, consentVersion: 'c1-ha', consentLanguage: 'ha' as const,
      capturedAt: at, capturedBy: ids[by]!, deviceId: 'test-device',
    })))
  }

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    const conn = createDb(temp.url, { max: 4 })
    db = conn.db
    close = () => conn.client.end()

    await db.insert(units).values([
      unit('19', 'state', null),
      unit('19/01', 'lga', '19'),
      unit('19/01/01', 'ward', '19/01'),
      unit('19/01/02', 'ward', '19/01'),
    ])
    await db.insert(units).values([
      unit('19/01/01/001', 'pu', '19/01/01', { registeredVoters: 100 }),
      unit('19/01/01/002', 'pu', '19/01/01', { registeredVoters: 100 }),
      unit('19/01/01/003', 'pu', '19/01/01', { registeredVoters: 100 }),
      unit('19/01/02/001', 'pu', '19/01/02', { registeredVoters: 50 }),
      unit('19/01/02/002', 'pu', '19/01/02'),
    ])

    await lead('ward', 'WARD_LEAD', '19/01/01', 'active')
    await lead('wardInvited', 'WARD_LEAD', '19/01/01', 'invited', ago(2)) // a replacement ward lead, not set up
    await lead('a', 'PU_LEAD', '19/01/01/001', 'active', ago(40)) // captured yesterday: active
    await lead('b', 'PU_LEAD', '19/01/01/002', 'active', ago(40)) // last capture 10 days ago
    await lead('c', 'PU_LEAD', '19/01/02/001', 'active', ago(30)) // never captured, set up 30 days ago
    await lead('g', 'PU_LEAD', '19/01/02/002', 'active') // joined today: not inactive yet
    await lead('e', 'PU_LEAD', '19/01/01/003', 'invited', ago(9)) // invited, never set up
    await lead('f', 'PU_LEAD', '19/01/01/003', 'deactivated', ago(60))
    // e's invite was re-sent 5 days ago: count from the latest invite.
    await db.insert(invites).values([
      { userId: ids.e!, tokenHash: 'h1', expiresAt: ago(-1), createdAt: ago(9) },
      { userId: ids.e!, tokenHash: 'h2', expiresAt: ago(-1), createdAt: ago(5) },
    ])

    await capture('19/01/01/001', 'a', 3, ago(1))
    await capture('19/01/01/001', 'a', 1, ago(20))
    await capture('19/01/01/002', 'b', 2, ago(10))
    await capture('19/01/02/001', 'ward', 4, ago(2)) // captured by someone else: c stays inactive
    await recomputePuStats(db)
    await db.insert(unitTargets).values({ unitCode: '19/01/01', target: 8 })
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  describe('leaderboard', () => {
    it('ranks PUs by captures in the last 7 days, ties on total supporters', async () => {
      const board = await leaderboard(db, '19/01', 'pu', 'recent', 20)
      if (!board || board === 'bad_level') throw new Error('expected a board')
      expect(board.level).toBe('pu')
      expect(board.total).toBe(5)
      expect(board.rows.map(r => [r.rank, r.code, r.value, r.supporters])).toEqual([
        [1, '19/01/02/001', 4, 4],
        [2, '19/01/01/001', 3, 4],
        [3, '19/01/01/002', 0, 2],
        [4, '19/01/01/003', 0, 0],
        [5, '19/01/02/002', 0, 0],
      ])
      expect(JSON.stringify(board)).not.toMatch(/\+234|Test Supporter|Lead /)
    })

    it('defaults to one level down; progress and coverage rank units without a value last', async () => {
      const recent = await leaderboard(db, '19/01', undefined, 'recent', 20)
      expect(recent !== 'bad_level' && recent?.rows.map(r => [r.code, r.recent])).toEqual([['19/01/02', 4], ['19/01/01', 3]])
      const progress = await leaderboard(db, '19/01', 'ward', 'progress', 20)
      expect(progress !== 'bad_level' && progress?.rows.map(r => [r.code, r.value])).toEqual([['19/01/01', 0.75], ['19/01/02', null]])
      const coverage = await leaderboard(db, '19/01/01', 'pu', 'coverage', 2)
      expect(coverage !== 'bad_level' && coverage?.rows.map(r => [r.code, r.value])).toEqual([['19/01/01/001', 0.04], ['19/01/01/002', 0.02]])
      expect(coverage !== 'bad_level' && coverage?.total).toBe(3)
    })

    it('stays inside the unit; refuses a level at or above it; null for unknown units', async () => {
      const ward = await leaderboard(db, '19/01/01', 'pu', 'recent', 20)
      expect(ward !== 'bad_level' && ward?.rows.every(r => r.code.startsWith('19/01/01/'))).toBe(true)
      expect(await leaderboard(db, '19/01', 'lga', 'recent', 20)).toBe('bad_level')
      expect(await leaderboard(db, '19/01/01/001', undefined, 'recent', 20)).toBe('bad_level')
      expect(await leaderboard(db, '19/99', undefined, 'recent', 20)).toBeNull()
      const region = await leaderboard(db, '', undefined, 'recent', 20)
      expect(region !== 'bad_level' && region?.rows.map(r => r.code)).toEqual(['19'])
    })
  })

  describe('inactiveLeads', () => {
    it('lists active PU leads without captures in N days, longest first, from setting up when they never captured', async () => {
      const list = (await inactiveLeads(db, '19/01', 3))!
      expect(list.inactive.map(l => [l.name, l.unitCode, l.daysInactive, l.lastCaptureAt === null])).toEqual([
        ['Lead c', '19/01/02/001', 30, true],
        ['Lead b', '19/01/01/002', 10, false],
      ])
      expect(list.inactiveTotal).toBe(2)
      expect(JSON.stringify(list)).not.toMatch(/\+234/)
      // A longer window: b's 10 days no longer count.
      expect((await inactiveLeads(db, '19/01', 14))!.inactive.map(l => l.name)).toEqual(['Lead c'])
    })

    it('lists invited leads below the unit who never set up, from the latest invite; never deactivated ones', async () => {
      const lga = (await inactiveLeads(db, '19/01', 3))!
      expect(lga.notStarted.map(l => [l.name, l.role, l.daysSinceInvite])).toEqual([['Lead e', 'PU_LEAD', 5], ['Lead wardInvited', 'WARD_LEAD', 2]])
      expect(lga.notStartedTotal).toBe(2)
      // The ward's own replacement lead isn't "below" the ward lead.
      const ward = (await inactiveLeads(db, '19/01/01', 3))!
      expect(ward.notStarted.map(l => l.name)).toEqual(['Lead e'])
      expect(ward.inactive.map(l => l.name)).toEqual(['Lead b'])
      expect(JSON.stringify(lga)).not.toContain('Lead f')
    })

    it('null for unknown units', async () => {
      expect(await inactiveLeads(db, '19/99', 3)).toBeNull()
    })
  })
})
