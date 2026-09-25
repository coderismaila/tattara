import { describe, expect, it } from 'vitest'
import { DEV_SHAPE, DEV_SOURCE_VERSION, DEV_STATES, generateDevGeography } from '../../scripts/seed/dev-geography'
import { parentCode, parsePuCode } from '../../shared/utils/pu-code'
import { normaliseName } from '../../shared/utils/text'

const { units, targets } = generateDevGeography()
const byCode = new Map(units.map(u => [u.code, u]))

describe('generateDevGeography', () => {
  it('has the SEED_DATA §5 shape: 2 states × 3 LGAs × 4 wards × 10 PUs', () => {
    const count = (level: string) => units.filter(u => u.level === level).length
    const states = DEV_STATES.length
    expect(count('state')).toBe(states)
    expect(count('lga')).toBe(states * DEV_SHAPE.lgasPerState)
    expect(count('ward')).toBe(states * DEV_SHAPE.lgasPerState * DEV_SHAPE.wardsPerLga)
    expect(count('pu')).toBe(states * DEV_SHAPE.lgasPerState * DEV_SHAPE.wardsPerLga * DEV_SHAPE.pusPerWard)
    expect(units.filter(u => u.level === 'state').map(u => u.name)).toEqual(['KANO', 'KATSINA'])
  })

  it('uses valid codes whose level and parent match the DB constraints', () => {
    expect(new Set(units.map(u => u.code)).size).toBe(units.length)
    for (const u of units) {
      expect(parsePuCode(u.code)?.level, u.code).toBe(u.level)
      const parent = parentCode(u.code)
      expect(u.parentCode, u.code).toBe(parent === '' ? null : parent)
      if (u.parentCode) expect(byCode.has(u.parentCode), u.code).toBe(true)
    }
  })

  it('lists parents before children (insert order)', () => {
    const seen = new Set<string>()
    for (const u of units) {
      if (u.parentCode) expect(seen.has(u.parentCode), u.code).toBe(true)
      seen.add(u.code)
    }
  })

  it('is deterministic', () => {
    expect(generateDevGeography()).toEqual(generateDevGeography())
    expect(generateDevGeography(1)).not.toEqual(generateDevGeography(2))
  })

  it('keeps every location inside the NW bounding box (SEED_DATA §3)', () => {
    for (const u of units) {
      expect(u.location.lat, u.code).toBeGreaterThanOrEqual(9)
      expect(u.location.lat, u.code).toBeLessThanOrEqual(14)
      expect(u.location.lng, u.code).toBeGreaterThanOrEqual(3)
      expect(u.location.lng, u.code).toBeLessThanOrEqual(10.5)
    }
  })

  it('places PUs within ~1 km of their ward centre', () => {
    for (const pu of units.filter(u => u.level === 'pu')) {
      const ward = byCode.get(pu.parentCode!)!
      expect(Math.abs(pu.location.lat - ward.location.lat)).toBeLessThanOrEqual(0.008)
      expect(Math.abs(pu.location.lng - ward.location.lng)).toBeLessThanOrEqual(0.008)
    }
  })

  it('sums registered voters up the hierarchy', () => {
    for (const u of units.filter(u => u.level !== 'pu')) {
      const children = units.filter(c => c.parentCode === u.code)
      expect(u.registeredVoters, u.code).toBe(children.reduce((a, c) => a + c.registeredVoters, 0))
    }
    for (const pu of units.filter(u => u.level === 'pu')) {
      expect(pu.registeredVoters).toBeGreaterThanOrEqual(300)
      expect(pu.registeredVoters).toBeLessThanOrEqual(1200)
    }
  })

  it('normalises names and marks every row as fake', () => {
    for (const u of units) {
      expect(u.nameNormalised).toBe(normaliseName(u.name))
      expect(u.sourceVersion).toBe(DEV_SOURCE_VERSION)
    }
  })

  it('sets consistent targets for states, LGAs and wards', () => {
    const t = new Map(targets.map(x => [x.unitCode, x.target]))
    expect(targets).toHaveLength(units.filter(u => u.level !== 'pu').length)
    for (const u of units.filter(u => u.level === 'lga' || u.level === 'state')) {
      const childSum = units.filter(c => c.parentCode === u.code).reduce((a, c) => a + t.get(c.code)!, 0)
      expect(t.get(u.code), u.code).toBe(childSum)
    }
    for (const ward of units.filter(u => u.level === 'ward')) {
      expect(t.get(ward.code)).toBe(Math.round(ward.registeredVoters * 0.3))
    }
  })
})
