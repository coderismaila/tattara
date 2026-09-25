import { describe, expect, it } from 'vitest'
import { pointInGeometry, type PolygonalGeometry } from '../../scripts/boundaries/geometry'
import { jaroWinkler, matchBoundaries, matchKey, nameScore, type BoundaryFeature } from '../../scripts/boundaries/match'
import type { NormalisedUnit } from '../../scripts/import/inec'

describe('jaroWinkler', () => {
  it('matches reference values', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3)
    expect(jaroWinkler('dwayne', 'duane')).toBeCloseTo(0.84, 2)
    expect(jaroWinkler('dixon', 'dicksonx')).toBeCloseTo(0.813, 3)
    expect(jaroWinkler('abc', 'abc')).toBe(1)
    expect(jaroWinkler('abc', '')).toBe(0)
  })
})

describe('nameScore / matchKey', () => {
  it('ignores case, punctuation and hooked letters', () => {
    expect(nameScore('KANO MUNICIPAL', 'Kano Municipal')).toBe(1)
    expect(nameScore('ƊAN AGUNDI', 'Dan-Agundi')).toBe(1)
  })

  it('compares with spaces removed too', () => {
    expect(nameScore('DAN BATTA', 'Danbatta')).toBe(1)
  })

  it('treats Roman numerals as digits', () => {
    expect(matchKey('ALIERO DANGALADIMA II')).toBe('aliero dangaladima 2')
    expect(nameScore('DANGALADIMA II', 'Dangaladima 2')).toBe(1)
    expect(nameScore('DANGALADIMA II', 'Dangaladima 1')).toBeLessThan(1)
  })

  it('scores a real INEC/GRID3 spelling pair above the threshold', () => {
    expect(nameScore('DAWAKI KUDU', 'Dawakin Kudu')).toBeGreaterThan(0.92)
  })
})

// Unit squares on a grid: square(x, y) covers [x, x+1] × [y, y+1].
const square = (x: number, y: number, w = 1, h = 1): PolygonalGeometry => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]],
})

describe('pointInGeometry', () => {
  it('handles polygons with holes and multipolygons', () => {
    const withHole: PolygonalGeometry = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]],
      ],
    }
    expect(pointInGeometry({ lng: 0.5, lat: 0.5 }, withHole)).toBe(true)
    expect(pointInGeometry({ lng: 2, lat: 2 }, withHole)).toBe(false)
    const multi: PolygonalGeometry = { type: 'MultiPolygon', coordinates: [square(0, 0).coordinates as never, square(5, 5).coordinates as never] }
    expect(pointInGeometry({ lng: 5.5, lat: 5.5 }, multi)).toBe(true)
    expect(pointInGeometry({ lng: 3, lat: 3 }, multi)).toBe(false)
  })
})

// A tiny fixture: Kano (19) with one LGA (19/01) and four wards; GRID3 features on a grid.
function unit(code: string, name: string, extra: Partial<NormalisedUnit> = {}): NormalisedUnit {
  const depth = code.split('/').length
  const level = (['state', 'lga', 'ward', 'pu'] as const)[depth - 1]!
  return {
    code,
    level,
    parentCode: depth === 1 ? null : code.split('/').slice(0, -1).join('/'),
    name,
    nameNormalised: name.toLowerCase(),
    registeredVoters: null,
    location: null,
    locationEstimated: false,
    boundaryRef: null,
    sourceVersion: 't',
    ...extra,
  }
}
/** PUs with real INEC points at the given coordinates. */
const pusAt = (ward: string, pts: [number, number][]) =>
  pts.map(([lng, lat], i) => unit(`${ward}/${String(i + 1).padStart(3, '0')}`, 'PU', { location: { lng, lat } }))

const feature = (id: string, level: BoundaryFeature['level'], name: string, geometry: PolygonalGeometry, extra: Partial<BoundaryFeature> = {}): BoundaryFeature =>
  ({ id, level, stateCode: '19', name, altNames: [], geometry, ...(level === 'ward' && { lgaName: 'Ajingi' }), ...extra })

const inside = (x: number, y: number): [number, number][] => [[x + 0.2, y + 0.2], [x + 0.5, y + 0.5], [x + 0.8, y + 0.7]]

function fixture() {
  const units = [
    unit('19', 'KANO'),
    unit('19/01', 'AJINGI'),
    unit('19/01/01', 'GAFASA'), // exact name + points agree
    unit('19/01/02', 'BALARE'), // exact name, but its points lie in DUNDUN's polygon
    unit('19/01/03', 'CHULA KASA'), // no name match; points in the unnamed polygon
    unit('19/01/04', 'TORANKE'), // no name, no points → unresolved
    ...pusAt('19/01/01', inside(0, 0)),
    ...pusAt('19/01/02', inside(2, 0)),
    ...pusAt('19/01/03', inside(3, 0)),
  ]
  const features = [
    feature('s:1', 'state', 'Kano', square(0, 0, 5, 1)),
    feature('l:1', 'lga', 'Ajingi', square(0, 0, 5, 1)),
    feature('w:1', 'ward', 'Gafasa', square(0, 0)),
    feature('w:2', 'ward', 'Balare', square(1, 0)),
    feature('w:3', 'ward', 'Dundun', square(2, 0)),
    feature('w:4', 'ward', 'Kunkurawa', square(3, 0)),
    feature('w:9', 'ward', 'Elsewhere', square(10, 10), { lgaName: 'Other LGA' }),
  ]
  return { units, features }
}

describe('matchBoundaries', () => {
  it('matches by name and position, flags disagreements, and leaves the rest for the human', () => {
    const r = matchBoundaries(fixture())
    const m = (code: string) => r.matches.find(x => x.code === code)

    expect(m('19')).toMatchObject({ featureIds: ['s:1'], method: 'name' })
    expect(m('19/01')).toMatchObject({ featureIds: ['l:1'], method: 'name+spatial' })
    expect(m('19/01/01')).toMatchObject({ featureIds: ['w:1'], method: 'name+spatial', review: false })
    // Exact name wins over the disagreeing points, but is flagged.
    expect(m('19/01/02')).toMatchObject({ featureIds: ['w:2'], method: 'name', review: true })
    expect(m('19/01/02')!.note).toMatch(/100% of its PUs lie in Dundun/)
    // No name match: the spatial majority is accepted for review.
    expect(m('19/01/03')).toMatchObject({ featureIds: ['w:4'], method: 'spatial', review: true, spatialShare: 1 })

    expect(r.unresolved.map(u => u.code)).toEqual(['19/01/04'])
    expect(r.unmatchedFeatures.map(f => f.id).sort()).toEqual(['w:3', 'w:9'])
    // BALARE's three points sit outside its matched polygon.
    expect(r.puOutsideWard.map(p => p.wardCode)).toEqual(['19/01/02', '19/01/02', '19/01/02'])
  })

  it('sends a weaker name match that the points contradict to the human', () => {
    const { units, features } = fixture()
    const r = matchBoundaries({
      // 'BALARI' vs 'Balare' scores 0.933: a match, but below STRONG_NAME.
      units: units.map(u => (u.code === '19/01/02' ? { ...u, name: 'BALARI' } : u)),
      features,
    })
    expect(r.matches.find(x => x.code === '19/01/02')).toBeUndefined()
    const u = r.unresolved.find(x => x.code === '19/01/02')!
    expect(u.reason).toMatch(/Name points to Balare .* but 100% of its PUs lie in Dundun/)
  })

  it('applies the manual crosswalk first', () => {
    const r = matchBoundaries({ ...fixture(), manual: new Map([['w:3', '19/01/04']]) })
    expect(r.matches.find(x => x.code === '19/01/04')).toMatchObject({ featureIds: ['w:3'], method: 'manual' })
    expect(r.unresolved).toEqual([])
  })

  it('prefers a primary-name match over an alternative-name tie', () => {
    const units = [unit('19', 'KANO'), unit('19/01', 'AJINGI'), unit('19/01/01', 'DAN ALKIMA'), unit('19/01/02', 'DAN ALI')]
    const features = [
      feature('s:1', 'state', 'Kano', square(0, 0, 5, 1)),
      feature('l:1', 'lga', 'Ajingi', square(0, 0, 5, 1)),
      feature('w:1', 'ward', 'Dan Ali', square(0, 0), { altNames: ['Dan Alkima'] }),
    ]
    const r = matchBoundaries({ units, features })
    expect(r.matches.find(x => x.featureIds[0] === 'w:1')?.code).toBe('19/01/02')
  })

  it('finds wards when GRID3 spells the LGA differently in its ward layer', () => {
    const units = [unit('19', 'KANO'), unit('19/15', 'GARUN MALAM'), unit('19/15/01', 'CHIROMAWA')]
    const features = [
      feature('s:1', 'state', 'Kano', square(0, 0)),
      feature('l:1', 'lga', 'Garun Malam', square(0, 0)),
      feature('w:1', 'ward', 'Chiromawa', square(0, 0), { lgaName: 'Garum Mallam' }),
    ]
    expect(matchBoundaries({ units, features }).matches.find(x => x.code === '19/15/01')?.featureIds).toEqual(['w:1'])
  })
})
