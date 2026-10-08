// Task 6.3: colour classes (fixed for coverage, quantiles otherwise), legend, boundary filtering and the breadcrumb.
import { describe, expect, it } from 'vitest'
import { MAP_RAMP, NO_DATA_COLOR, breadcrumb, childLayer, classBreaks, classOf, colorOf, featuresUnder, legendRows } from '../../app/utils/map-classes'

describe('classes', () => {
  it('coverage uses the fixed classes 0–10, 10–25, 25–40, 40–60, 60%+', () => {
    const b = classBreaks([0.5], 'coverage')
    expect(b).toEqual([0.1, 0.25, 0.4, 0.6])
    expect([0, 0.099, 0.1, 0.249, 0.25, 0.4, 0.599, 0.6, 1.4].map(v => classOf(v, b))).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4])
  })

  it('other metrics use quantiles of the values present', () => {
    const b = classBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null], 'supporters')
    expect(b).toEqual([3, 5, 7, 9])
    expect(classOf(1, b)).toBe(0)
    expect(classOf(10, b)).toBe(4)
  })

  it('ties collapse classes; no values give no breaks; missing values are grey', () => {
    expect(classBreaks([5, 5, 5, 5], 'supporters')).toEqual([])
    expect(classBreaks([null, null], 'flaggedOpen')).toEqual([])
    expect(classOf(null, [1])).toBeNull()
    expect(colorOf(null, [1])).toBe(NO_DATA_COLOR)
    expect(colorOf(0, [])).toBe(MAP_RAMP[0])
  })

  it('legend rows: one per class, the last open-ended', () => {
    expect(legendRows([0.1, 0.25], v => `${Math.round(v * 100)}%`)).toEqual([
      { color: MAP_RAMP[0], from: '0%', to: '10%' },
      { color: MAP_RAMP[1], from: '10%', to: '25%' },
      { color: MAP_RAMP[2], from: '25%', to: null },
    ])
  })
})

describe('layers', () => {
  it('region → states, state → LGAs, LGA → that state\u2019s wards, ward → PU points', () => {
    expect(childLayer('')).toEqual({ kind: 'states', file: '/geo/nw-states.geojson' })
    expect(childLayer('19')).toEqual({ kind: 'lgas', file: '/geo/nw-lgas.geojson' })
    expect(childLayer('19/05')).toEqual({ kind: 'wards', file: '/geo/wards/19.geojson' })
    expect(childLayer('19/05/03')).toEqual({ kind: 'pus', file: null })
  })

  it('keeps only the direct children of a unit', () => {
    const f = (code: string) => ({ properties: { code } })
    const features = [f('19'), f('20'), f('19/01'), f('19/02'), f('20/01'), f('19/01/01'), f('19/01/02'), f('19/02/01'), { properties: null }]
    expect(featuresUnder(features, '').map(x => x.properties!.code)).toEqual(['19', '20'])
    expect(featuresUnder(features, '19').map(x => x.properties!.code)).toEqual(['19/01', '19/02'])
    expect(featuresUnder(features, '19/01').map(x => x.properties!.code)).toEqual(['19/01/01', '19/01/02'])
  })
})

describe('breadcrumb', () => {
  const names = { '19': 'KANO', '19/01': 'AJINGI', '19/01/01': 'AJINGI' }
  it('runs from the caller\u2019s top unit down to the one shown', () => {
    expect(breadcrumb('19/01/01', '', names, 'NW').map(c => c.code)).toEqual(['', '19', '19/01', '19/01/01'])
    expect(breadcrumb('19/01/01', '19/01', names, 'NW')).toEqual([{ code: '19/01', name: 'AJINGI' }, { code: '19/01/01', name: 'AJINGI' }])
    expect(breadcrumb('19', '', {}, 'NW')).toEqual([{ code: '', name: 'NW' }, { code: '19', name: '19' }])
  })
})
