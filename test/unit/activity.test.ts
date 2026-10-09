// Task 6.5: which level a leaderboard shows and the query schemas (ranking is SQL: test/integration/activity.test.ts).
import { describe, expect, it } from 'vitest'
import { leaderboardLevel } from '../../server/services/activity'
import { inactiveQuerySchema, leaderboardQuerySchema } from '../../shared/schemas/stats'

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
