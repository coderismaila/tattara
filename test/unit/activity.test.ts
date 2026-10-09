// Task 6.5: which level a leaderboard shows, how units are ranked, and the query schemas.
import { describe, expect, it } from 'vitest'
import { leaderboardLevel, rankRows } from '../../server/services/activity'
import { inactiveQuerySchema, leaderboardQuerySchema } from '../../shared/schemas/stats'

const row = (code: string, over: Partial<{ recent: number, supporters: number, progress: number | null, coverage: number | null }> = {}) => ({
  code, name: code, recent: 0, supporters: 0, progress: null, coverage: null, ...over,
})

describe('leaderboardLevel', () => {
  it('defaults to one level down', () => {
    expect(leaderboardLevel('')).toBe('state')
    expect(leaderboardLevel('19')).toBe('lga')
    expect(leaderboardLevel('19/01/01')).toBe('pu')
    expect(leaderboardLevel('19/01/01/001')).toBeNull()
  })

  it('accepts any level strictly below, nothing at or above', () => {
    expect(leaderboardLevel('19', 'pu')).toBe('pu')
    expect(leaderboardLevel('', 'ward')).toBe('ward')
    expect(leaderboardLevel('19/01', 'lga')).toBeNull()
    expect(leaderboardLevel('19/01', 'state')).toBeNull()
  })
})

describe('rankRows', () => {
  it('ranks highest first, ties on total supporters then code', () => {
    const ranked = rankRows([row('b', { recent: 5, supporters: 10 }), row('a', { recent: 5, supporters: 10 }), row('c', { recent: 5, supporters: 40 }), row('d', { recent: 9 })], 'recent')
    expect(ranked.map(r => [r.rank, r.code, r.value])).toEqual([[1, 'd', 9], [2, 'c', 5], [3, 'a', 5], [4, 'b', 5]])
  })

  it('puts units without a value last, whatever their totals', () => {
    const ranked = rankRows([row('a', { supporters: 900 }), row('b', { progress: 0.1 }), row('c', { progress: 0.8 })], 'progress')
    expect(ranked.map(r => r.code)).toEqual(['c', 'b', 'a'])
    expect(ranked[2]!.value).toBeNull()
  })

  it('ranks zero captures above no value (a 0 is still a value)', () => {
    expect(rankRows([row('a', { coverage: null }), row('b', { coverage: 0 })], 'coverage').map(r => r.code)).toEqual(['b', 'a'])
  })
})

describe('query schemas', () => {
  it('leaderboard: recent by default, 20 rows, at most 100', () => {
    expect(leaderboardQuerySchema.parse({})).toEqual({ metric: 'recent', limit: 20 })
    expect(leaderboardQuerySchema.parse({ level: 'pu', metric: 'progress', limit: '5' })).toEqual({ level: 'pu', metric: 'progress', limit: 5 })
    expect(leaderboardQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(leaderboardQuerySchema.safeParse({ metric: 'flags' }).success).toBe(false)
    expect(leaderboardQuerySchema.safeParse({ level: 'region' }).success).toBe(false)
  })

  it('inactive: 3 days by default, 1 to 30', () => {
    expect(inactiveQuerySchema.parse({})).toEqual({ days: 3 })
    expect(inactiveQuerySchema.parse({ days: '14' })).toEqual({ days: 14 })
    expect(inactiveQuerySchema.safeParse({ days: 0 }).success).toBe(false)
    expect(inactiveQuerySchema.safeParse({ days: 31 }).success).toBe(false)
  })
})
