// Task 6.4: who may set and split targets, the largest-remainder split and its basis, and the request schemas.
import { describe, expect, it } from 'vitest'
import { allocation } from '../../app/utils/targets'
import { canDistribute, canSetTarget, chooseBasis, splitProportional } from '../../server/services/targets'
import { MAX_TARGET, distributeSchema, targetSchema } from '../../shared/schemas/targets'
import type { Role } from '../../shared/constants/roles'

const lead = (role: Role, unitCode: string | null) => ({ role, unitCode })

describe('canSetTarget', () => {
  it('lets the DG set state targets only', () => {
    const dg = lead('DG', null)
    expect(canSetTarget(dg, '19')).toBe(true)
    expect(canSetTarget(dg, '19/01')).toBe(false)
    expect(canSetTarget(dg, '19/01/01/001')).toBe(false)
  })

  it('lets a lead set the units directly below their own, nothing else', () => {
    const cases: [Role, string][] = [['STATE_LEAD', '19'], ['LGA_LEAD', '19/01'], ['WARD_LEAD', '19/01/01']]
    for (const [role, unit] of cases) {
      const me = lead(role, unit)
      const child = role === 'WARD_LEAD' ? `${unit}/001` : `${unit}/01`
      expect(canSetTarget(me, child)).toBe(true)
      expect(canSetTarget(me, unit)).toBe(false) // own unit: set by the level above
      expect(canSetTarget(me, '20/01')).toBe(false) // another state
    }
    expect(canSetTarget(lead('STATE_LEAD', '19'), '19/01/01')).toBe(false) // a grandchild
    expect(canSetTarget(lead('LGA_LEAD', '19/01'), '19/02/01')).toBe(false) // a sibling LGA's ward
  })

  it('never lets the admin or a PU lead set targets, nor anyone on a malformed code', () => {
    expect(canSetTarget(lead('ADMIN', null), '19')).toBe(false)
    expect(canSetTarget(lead('PU_LEAD', '19/01/01/001'), '19/01/01/001')).toBe(false)
    expect(canSetTarget(lead('STATE_LEAD', '19'), '19/1')).toBe(false)
    expect(canSetTarget(lead('DG', null), '')).toBe(false)
  })
})

describe('canDistribute', () => {
  it('only the lead of the unit itself, above PU level', () => {
    expect(canDistribute(lead('STATE_LEAD', '19'), '19')).toBe(true)
    expect(canDistribute(lead('LGA_LEAD', '19/01'), '19/01')).toBe(true)
    expect(canDistribute(lead('WARD_LEAD', '19/01/01'), '19/01/01')).toBe(true)
    expect(canDistribute(lead('STATE_LEAD', '19'), '19/01')).toBe(false)
    expect(canDistribute(lead('LGA_LEAD', '19/01'), '19')).toBe(false)
    expect(canDistribute(lead('PU_LEAD', '19/01/01/001'), '19/01/01/001')).toBe(false)
    expect(canDistribute(lead('DG', null), '19')).toBe(false)
    expect(canDistribute(lead('ADMIN', null), '19')).toBe(false)
  })
})

describe('splitProportional', () => {
  it('adds up to the total exactly', () => {
    for (const [total, weights] of [[1000, [1, 1, 1]], [7, [3, 5, 9, 1]], [123_457, [312, 999, 4, 0, 77]], [0, [5, 5]]] as const) {
      const out = splitProportional(total, weights)
      expect(out.reduce((a, b) => a + b, 0)).toBe(total)
      expect(out.every(x => Number.isInteger(x) && x >= 0)).toBe(true)
    }
  })

  it('follows the weights, giving ties to the earlier unit', () => {
    expect(splitProportional(100, [1, 3])).toEqual([25, 75])
    expect(splitProportional(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(splitProportional(10, [0, 1, 1])).toEqual([0, 5, 5])
  })

  it('splits evenly when every weight is zero, and returns nothing for no units', () => {
    expect(splitProportional(9, [0, 0, 0])).toEqual([3, 3, 3])
    expect(splitProportional(9, [])).toEqual([])
  })
})

describe('chooseBasis', () => {
  const full = (voters: number, pus: number) => ({ voters, pusWithFigure: pus, totalPus: pus })

  it('uses registered voters when every PU below has reported', () => {
    expect(chooseBasis([full(500, 2), full(900, 3)])).toBe('registered_voters')
  })

  it('falls back to PU count for everyone when any PU is missing a figure', () => {
    expect(chooseBasis([full(500, 2), { voters: 300, pusWithFigure: 1, totalPus: 3 }])).toBe('pu_count')
    expect(chooseBasis([{ voters: null, pusWithFigure: 0, totalPus: 4 }])).toBe('pu_count')
  })

  it('falls back to PU count when the figures add up to nothing', () => {
    expect(chooseBasis([full(0, 0), full(0, 0)])).toBe('pu_count')
  })
})

describe('target schemas', () => {
  it('accepts whole numbers from 0 up to the maximum, from a form string too', () => {
    expect(targetSchema.parse({ target: '1500' })).toEqual({ target: 1500 })
    expect(targetSchema.parse({ target: 0 })).toEqual({ target: 0 })
    expect(targetSchema.safeParse({ target: -1 }).success).toBe(false)
    expect(targetSchema.safeParse({ target: 2.5 }).success).toBe(false)
    expect(targetSchema.safeParse({ target: MAX_TARGET + 1 }).error?.issues[0]?.message).toBe('targets.errors.tooBig')
    expect(targetSchema.safeParse({ target: 5, extra: 1 }).success).toBe(false)
  })

  it('defaults to a saved proportional split and refuses other methods', () => {
    expect(distributeSchema.parse({})).toEqual({ method: 'proportional', preview: false })
    expect(distributeSchema.parse({ preview: true }).preview).toBe(true)
    expect(distributeSchema.safeParse({ method: 'equal' }).success).toBe(false)
  })
})

describe('allocation (Targets page)', () => {
  it('reports what is left, what is over, or that it adds up, counting unset children as 0', () => {
    expect(allocation(null, [5])).toEqual({ kind: 'no_target' })
    expect(allocation(100, [30, null, 20])).toEqual({ kind: 'under', amount: 50 })
    expect(allocation(100, [60, 60])).toEqual({ kind: 'over', amount: 20 })
    expect(allocation(100, [40, 60])).toEqual({ kind: 'exact' })
    expect(allocation(0, [])).toEqual({ kind: 'exact' })
  })
})
