// Task 6.1: coverage, the children ordering (missing values last whatever the direction) and the query defaults.
import { describe, expect, it } from 'vitest'
import { childrenStatsQuerySchema } from '../../shared/schemas/stats'
import type { ChildStats } from '../../shared/types/stats'
import { coverageOf, sortChildren } from '../../server/services/stats'

const row = (code: string, over: Partial<ChildStats> = {}): ChildStats => ({
  code, name: code, level: 'pu', supporters: 0, verified: 0, verifiedRate: null, flaggedOpen: 0,
  registeredVoters: { sum: null, pusWithFigure: 0, totalPus: 1 }, coverage: null, target: null, progress: null, activeLeads: 0, ...over,
})

describe('coverageOf', () => {
  it('is supporters on reported PUs over their voters; none without a figure', () => {
    expect(coverageOf(45, 500)).toBe(0.09)
    expect(coverageOf(45, null)).toBeNull()
    expect(coverageOf(45, 0)).toBeNull()
  })
})

describe('sortChildren', () => {
  const rows = [row('a', { coverage: 0.3, supporters: 10 }), row('b'), row('c', { coverage: 0.1, supporters: 30 }), row('d', { coverage: 0.3, supporters: 20 })]

  it('ascending, ties by code, missing values last', () => {
    expect(sortChildren(rows, 'coverage', 'asc').map(r => r.code)).toEqual(['c', 'a', 'd', 'b'])
  })

  it('descending keeps missing values last too', () => {
    expect(sortChildren(rows, 'coverage', 'desc').map(r => r.code)).toEqual(['a', 'd', 'c', 'b'])
  })

  it('works on any metric and leaves the input alone', () => {
    expect(sortChildren(rows, 'supporters', 'desc').map(r => r.code)).toEqual(['c', 'd', 'a', 'b'])
    expect(rows.map(r => r.code)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('childrenStatsQuerySchema', () => {
  it('defaults to coverage, lowest first; refuses unknown metrics', () => {
    expect(childrenStatsQuerySchema.parse({})).toEqual({ metric: 'coverage', sort: 'asc' })
    expect(childrenStatsQuerySchema.safeParse({ metric: 'names' }).success).toBe(false)
  })
})
