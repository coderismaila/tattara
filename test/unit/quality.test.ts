// Task 5.5: the quality score formula (PRD R-7, ADR-044).
import { describe, expect, it } from 'vitest'
import { QUALITY_MIN_SUPPORTERS, qualityScore, rollUpCodes, type QualityCounts } from '../../shared/utils/quality'

const counts = (over: Partial<QualityCounts> = {}): QualityCounts => ({
  supporters: 100, verified: 0, flags: 0, optedOut: 0, callsVerified: 0, callsFailed: 0, ...over,
})

describe('qualityScore', () => {
  it('a perfect unit scores 100, a fully verified-less but clean one 50', () => {
    expect(qualityScore(counts({ verified: 100 })).score).toBe(100)
    expect(qualityScore(counts()).score).toBe(50)
  })

  it('weights: half verified, a quarter flags, a quarter opt-outs', () => {
    // 80% verified, 5% flagged (part 0.8), 10% opted out (part 0.6) → 0.5·0.8 + 0.25·0.8 + 0.25·0.6 = 0.75
    expect(qualityScore(counts({ verified: 80, flags: 5, optedOut: 10 }))).toMatchObject({
      score: 75, verifiedRate: 0.8, flagRate: 0.05, optOutRate: 0.1, passRate: null, supporters: 100,
    })
  })

  it('flags or opt-outs at 25% or more zero their part, and never go below it', () => {
    expect(qualityScore(counts({ verified: 100, flags: 25 })).score).toBe(75)
    expect(qualityScore(counts({ verified: 100, flags: 300 })).score).toBe(75) // several flags per record
    expect(qualityScore(counts({ flags: 50, optedOut: 50 })).score).toBe(0)
  })

  it('the call-back pass rate counts once there are 5 answered calls', () => {
    expect(qualityScore(counts({ verified: 100, callsVerified: 3, callsFailed: 1 })).passRate).toBeNull()
    const q = qualityScore(counts({ verified: 100, callsVerified: 2, callsFailed: 3 }))
    expect(q.passRate).toBe(0.4)
    expect(q.score).toBe(Math.round(100 * (0.5 * 0.7 + 0.5))) // verified part = (1 + 0.4) / 2
  })

  it(`no score below ${QUALITY_MIN_SUPPORTERS} supporters, but the rates are still given`, () => {
    expect(qualityScore(counts({ supporters: 9, verified: 9 }))).toMatchObject({ score: null, verifiedRate: 1, supporters: 9 })
    expect(qualityScore(counts({ supporters: 0 }))).toMatchObject({ score: null, verifiedRate: 0, flagRate: 0 })
  })

  it('always stays within 0–100', () => {
    for (const v of [0, 37, 100]) {
      for (const f of [0, 13, 400]) {
        for (const o of [0, 9, 100]) {
          const s = qualityScore(counts({ verified: v, flags: f, optedOut: o, callsVerified: v % 7, callsFailed: f % 5 })).score!
          expect(s).toBeGreaterThanOrEqual(0)
          expect(s).toBeLessThanOrEqual(100)
        }
      }
    }
  })
})

describe('rollUpCodes', () => {
  it('a PU counts for itself, its ward, LGA and state', () => {
    expect(rollUpCodes('19/05/03/012')).toEqual(['19/05/03/012', '19/05/03', '19/05', '19'])
  })
})
