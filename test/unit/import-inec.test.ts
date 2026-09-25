import { describe, expect, it } from 'vitest'
import { normaliseInec, toUnitsCsv, type InecInputs, type InecPuRow } from '../../scripts/import/inec'

function pu(code: string, puName = `PU ${code}`, names: Partial<InecPuRow> = {}): InecPuRow {
  const [stateCode, lgaCode, wardCode, puCode] = code.split('/') as [string, string, string, string]
  return {
    stateCode,
    stateName: stateCode === '19' ? 'KANO' : stateCode === '20' ? 'KATSINA' : 'OTHER',
    lgaCode,
    lgaName: `LGA ${stateCode}/${lgaCode}`,
    wardCode,
    wardName: `WARD ${stateCode}/${lgaCode}/${wardCode}`,
    puCode,
    puName,
    ...names,
  }
}

const base = (over: Partial<InecInputs> = {}): InecInputs => ({
  hierarchy: [
    pu('19/01/01/001', 'KOFAR GABAS PRI. SCH.'),
    pu('19/01/01/002'),
    pu('19/01/02/001'),
    pu('20/01/01/001'),
  ],
  coords: new Map(),
  sourceVersion: 'test-v1',
  ...over,
})

const find = (units: ReturnType<typeof normaliseInec>['units'], code: string) => units.find(u => u.code === code)!

describe('normaliseInec: structure', () => {
  it('builds every level with parents, normalised names and the source version', () => {
    const { units, report } = normaliseInec(base())
    expect(units.map(u => u.code)).toEqual([
      '19', '20', '19/01', '20/01', '19/01/01', '19/01/02', '20/01/01',
      '19/01/01/001', '19/01/01/002', '19/01/02/001', '20/01/01/001',
    ])
    expect(find(units, '19/01/01/001')).toMatchObject({
      level: 'pu',
      parentCode: '19/01/01',
      name: 'KOFAR GABAS PRI. SCH.',
      nameNormalised: 'kofar gabas pri sch',
      sourceVersion: 'test-v1',
    })
    expect(find(units, '19')).toMatchObject({ level: 'state', parentCode: null, name: 'KANO' })
    expect(report.issues.filter(i => i.severity === 'error')).toEqual([])
  })

  it('errors on duplicate PU codes, conflicting names and non-NW states', () => {
    const { report } = normaliseInec(base({
      hierarchy: [
        pu('19/01/01/001'),
        pu('19/01/01/001'),
        pu('19/01/01/002', 'X', { wardName: 'A DIFFERENT WARD NAME' }),
        pu('24/01/01/001'), // Lagos
      ],
    }))
    const errors = report.issues.filter(i => i.severity === 'error').map(i => `${i.code}: ${i.message}`)
    expect(errors).toEqual(expect.arrayContaining([
      '19/01/01/001: Duplicate PU code',
      expect.stringMatching(/^19\/01\/01: Conflicting names/),
      expect.stringMatching(/^24\/01\/01\/001: State 24 is not one of the 7 NW states/),
    ]))
  })

  it('warns (does not fail) when counts differ from the PRD', () => {
    const { report } = normaliseInec(base())
    const kano = report.states.find(s => s.code === '19')!
    expect(kano).toMatchObject({ lgas: 1, wards: 2, pus: 3, expected: { lgas: 44, wards: 484, pus: 11222 } })
    expect(report.issues.some(i => i.severity === 'warning' && /KANO|Kano/.test(i.message) && /PRD expects/.test(i.message))).toBe(true)
  })
})

describe('normaliseInec: coordinates', () => {
  const kanoBox = { minLng: 7.6, minLat: 10.5, maxLng: 9.4, maxLat: 12.7 }

  it('uses INEC points, estimates the rest from the ward, then LGA, then state', () => {
    const { units, report } = normaliseInec(base({
      coords: new Map([
        ['19/01/01/001', { lat: 12.0, lng: 8.5 }],
        ['19/01/01/002', null], // INEC returned none
        // 19/01/02/001 never fetched
        ['20/01/01/001', { lat: 5.0, lng: 3.0 }], // outside NW → outlier
      ]),
      stateBoxes: new Map([['19', kanoBox]]),
    }))

    expect(find(units, '19/01/01/001')).toMatchObject({ location: { lat: 12.0, lng: 8.5 }, locationEstimated: false })
    // Same ward has a known point → ward centroid.
    expect(find(units, '19/01/01/002')).toMatchObject({ location: { lat: 12.0, lng: 8.5 }, locationEstimated: true })
    // Ward 02 has no known points → LGA centroid.
    expect(find(units, '19/01/02/001')).toMatchObject({ location: { lat: 12.0, lng: 8.5 }, locationEstimated: true })
    // Katsina's only point is an outlier → no location anywhere in the state.
    expect(find(units, '20/01/01/001')).toMatchObject({ location: null, locationEstimated: true })
    expect(find(units, '20')).toMatchObject({ location: null, locationEstimated: true })
    expect(find(units, '19/01/02')).toMatchObject({ location: { lat: 12.0, lng: 8.5 }, locationEstimated: true })
    expect(find(units, '19')).toMatchObject({ location: { lat: 12.0, lng: 8.5 }, locationEstimated: false })

    expect(report.coords).toEqual({ inec: 1, estimated: 3, outliers: 1, notFetched: 1, returnedNone: 1 })
    expect(report.issues.some(i => i.code === '20/01/01/001' && /outside/.test(i.message))).toBe(true)
  })

  it('checks each PU against its own state box (catches a point in the wrong state)', () => {
    const { units, report } = normaliseInec(base({
      coords: new Map([['19/01/01/001', { lat: 13.0, lng: 7.0 }]]), // inside NW, outside Kano
      stateBoxes: new Map([['19', kanoBox]]),
    }))
    expect(report.coords.outliers).toBe(1)
    expect(find(units, '19/01/01/001').locationEstimated).toBe(true)
  })

  it('averages PU points for ward/LGA/state centroids', () => {
    const { units } = normaliseInec(base({
      coords: new Map([
        ['19/01/01/001', { lat: 12.0, lng: 8.0 }],
        ['19/01/01/002', { lat: 12.2, lng: 8.4 }],
      ]),
    }))
    expect(find(units, '19/01/01').location).toEqual({ lat: 12.1, lng: 8.2 })
  })
})

describe('normaliseInec: registered voters', () => {
  it('leaves voters NULL and warns when there is no file', () => {
    const { units, report } = normaliseInec(base())
    expect(units.every(u => u.registeredVoters === null)).toBe(true)
    expect(report.issues.some(i => /No registered-voters file/.test(i.message))).toBe(true)
  })

  it('sums PU figures up the tree; a parent with any missing child stays NULL', () => {
    const { units, report } = normaliseInec(base({
      voters: new Map([
        ['19/01/01/001', 500],
        ['19/01/01/002', 300],
        ['19/01/02/001', 200],
        // 20/01/01/001 missing
        ['19/99/99/999', 10], // unknown
      ]),
    }))
    expect(find(units, '19/01/01').registeredVoters).toBe(800)
    expect(find(units, '19/01').registeredVoters).toBe(1000)
    expect(find(units, '19').registeredVoters).toBe(1000)
    expect(find(units, '20/01/01').registeredVoters).toBeNull()
    expect(report.voters).toEqual({ pus: 3, missing: 1 })
    expect(report.issues.some(i => i.code === '19/99/99/999' && i.severity === 'warning')).toBe(true)
  })

  it('errors on negative or non-integer figures', () => {
    const { report } = normaliseInec(base({ voters: new Map([['19/01/01/001', -1], ['19/01/01/002', 1.5]]) }))
    expect(report.issues.filter(i => i.severity === 'error').map(i => i.code).sort()).toEqual(['19/01/01/001', '19/01/01/002'])
  })
})

describe('toUnitsCsv', () => {
  it('writes the SEED_DATA §2 columns and escapes names', () => {
    const { units } = normaliseInec(base({
      hierarchy: [pu('19/01/01/001', 'KOFAR "GABAS", PS')],
      coords: new Map([['19/01/01/001', { lat: 12, lng: 8.5 }]]),
    }))
    const lines = toUnitsCsv(units).trim().split('\n')
    expect(lines[0]).toBe('code,level,parent_code,name,registered_voters,lat,lng,location_estimated,boundary_ref,source_version')
    expect(lines).toContain('19,state,,KANO,,12,8.5,false,,test-v1')
    expect(lines).toContain('19/01/01/001,pu,19/01/01,"KOFAR ""GABAS"", PS",,12,8.5,false,,test-v1')
  })
})

describe('normaliseInec: boundary join inputs', () => {
  it('falls back to ward polygon points before the LGA, and links GRID3 ids', () => {
    const { units } = normaliseInec(base({
      coords: new Map([['19/01/01/001', { lat: 12.0, lng: 8.5 }]]),
      wardPoints: new Map([
        ['19/01/02', { lat: 11.5, lng: 8.1 }],
        ['20/01/01', { lat: 13.0, lng: 7.6 }],
      ]),
      boundaryRefs: new Map([['19/01/02', 'grid3-ward-v3:7']]),
    }))
    // Ward 19/01/02 has no INEC points: its polygon point beats the LGA centroid.
    expect(find(units, '19/01/02/001')).toMatchObject({ location: { lat: 11.5, lng: 8.1 }, locationEstimated: true })
    expect(find(units, '19/01/02')).toMatchObject({ location: { lat: 11.5, lng: 8.1 }, locationEstimated: true, boundaryRef: 'grid3-ward-v3:7' })
    // A state with no INEC points at all gets located from its ward polygons.
    expect(find(units, '20/01/01/001').location).toEqual({ lat: 13.0, lng: 7.6 })
    expect(find(units, '20')).toMatchObject({ location: { lat: 13.0, lng: 7.6 }, locationEstimated: true })
    // Ward with its own INEC points: still their centroid.
    expect(find(units, '19/01/01/002').location).toEqual({ lat: 12.0, lng: 8.5 })
    expect(find(units, '19/01/01').boundaryRef).toBeNull()
  })
})
