// Normalise the INEC PU directory into `units` rows + a validation report (SEED_DATA §2–3).
// Pure: no file or DB access, so it is unit-testable. The CLI is scripts/import-inec-pus.ts.
import type { UnitLevel } from '../../shared/constants/enums.ts'
import { NW_STATES, isNwStateCode } from '../../shared/constants/states.ts'
import { isValidPuCode, parentCode, unitLevel } from '../../shared/utils/pu-code.ts'
import { normaliseName } from '../../shared/utils/text.ts'

/** One PU row from data/raw/inec/hierarchy.ndjson (see scripts/fetch/inec-pus.ts). */
export interface InecPuRow {
  stateCode: string
  stateName: string
  lgaCode: string
  lgaName: string
  wardCode: string
  wardName: string
  puCode: string
  puName: string
}

export interface LngLat {
  lng: number
  lat: number
}

export interface BBox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export interface InecInputs {
  hierarchy: InecPuRow[]
  /** PU code → coordinate (null = INEC returned none). PUs absent from the map were not fetched. */
  coords: Map<string, LngLat | null>
  /** PU code → registered voters (INEC 2023 register), when available. */
  voters?: Map<string, number>
  /** State code → bounding box (from GRID3 state polygons). Falls back to NW_BBOX. */
  stateBoxes?: Map<string, BBox>
  /** Ward code → interior point of its GRID3 polygon (data/normalised/ward-points.csv). */
  wardPoints?: Map<string, LngLat>
  /** Unit code → GRID3 feature id(s) (data/normalised/boundary-crosswalk.csv). */
  boundaryRefs?: Map<string, string>
  sourceVersion: string
}

export interface NormalisedUnit {
  code: string
  level: UnitLevel
  parentCode: string | null
  name: string
  nameNormalised: string
  registeredVoters: number | null
  location: LngLat | null
  locationEstimated: boolean
  boundaryRef: string | null
  sourceVersion: string
}

export interface Issue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface StateSummary {
  code: string
  name: string
  lgas: number
  wards: number
  pus: number
  expected: { lgas: number, wards: number, pus: number }
}

export interface ImportReport {
  states: StateSummary[]
  coords: { inec: number, estimated: number, outliers: number, notFetched: number, returnedNone: number }
  voters: { pus: number, missing: number }
  issues: Issue[]
}

/** Expected counts per state (PRD §3). A mismatch is a warning for the human to confirm, not a failure. */
export const EXPECTED_COUNTS: Record<string, { lgas: number, wards: number, pus: number }> = {
  17: { lgas: 27, wards: 287, pus: 4522 },
  18: { lgas: 23, wards: 255, pus: 8012 },
  19: { lgas: 44, wards: 484, pus: 11222 },
  20: { lgas: 34, wards: 361, pus: 6652 },
  21: { lgas: 21, wards: 225, pus: 3743 },
  33: { lgas: 23, wards: 244, pus: 3991 },
  36: { lgas: 14, wards: 147, pus: 3529 },
}

/** North West extent from GRID3 state polygons (Jigawa reaches lng 10.61), rounded outward. */
export const NW_BBOX: BBox = { minLng: 3.4, minLat: 9.0, maxLng: 10.7, maxLat: 14.0 }

/** Margin added to per-state boxes: INEC points near a border may sit just outside a simplified polygon. */
export const STATE_BOX_MARGIN = 0.05

const inBox = (p: LngLat, b: BBox, margin = 0) =>
  p.lng >= b.minLng - margin && p.lng <= b.maxLng + margin && p.lat >= b.minLat - margin && p.lat <= b.maxLat + margin

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

function mean(points: LngLat[]): LngLat | null {
  if (points.length === 0) return null
  const s = points.reduce((a, p) => ({ lng: a.lng + p.lng, lat: a.lat + p.lat }), { lng: 0, lat: 0 })
  return { lng: round6(s.lng / points.length), lat: round6(s.lat / points.length) }
}

export function normaliseInec(inputs: InecInputs): { units: NormalisedUnit[], report: ImportReport } {
  const issues: Issue[] = []
  const error = (code: string, message: string) => issues.push({ severity: 'error', code, message })
  const warn = (code: string, message: string) => issues.push({ severity: 'warning', code, message })

  // 1. Build every unit, checking codes and names are consistent across PU rows.
  const byCode = new Map<string, NormalisedUnit>()
  const add = (code: string, level: UnitLevel, name: string) => {
    const existing = byCode.get(code)
    const clean = name.trim().replace(/\s+/g, ' ')
    if (existing) {
      if (existing.name !== clean) error(code, `Conflicting names: "${existing.name}" vs "${clean}"`)
      return existing
    }
    if (!isValidPuCode(code) || unitLevel(code) !== level) {
      error(code, `Invalid ${level} code`)
    }
    if (!clean) error(code, 'Empty name')
    const parent = parentCode(code)
    const unit: NormalisedUnit = {
      code,
      level,
      parentCode: parent === '' || parent === null ? null : parent,
      name: clean,
      nameNormalised: normaliseName(clean),
      registeredVoters: null,
      location: null,
      locationEstimated: false,
      boundaryRef: null,
      sourceVersion: inputs.sourceVersion,
    }
    byCode.set(code, unit)
    return unit
  }

  const puCodes = new Set<string>()
  for (const r of inputs.hierarchy) {
    const lga = `${r.stateCode}/${r.lgaCode}`
    const ward = `${lga}/${r.wardCode}`
    const pu = `${ward}/${r.puCode}`
    if (!isNwStateCode(r.stateCode)) {
      error(pu, `State ${r.stateCode} is not one of the 7 NW states`)
      continue
    }
    if (puCodes.has(pu)) {
      error(pu, 'Duplicate PU code')
      continue
    }
    puCodes.add(pu)
    add(r.stateCode, 'state', r.stateName)
    add(lga, 'lga', r.lgaName)
    add(ward, 'ward', r.wardName)
    add(pu, 'pu', r.puName)
  }

  const units = [...byCode.values()]
  const pus = units.filter(u => u.level === 'pu')
  const childrenOf = new Map<string, NormalisedUnit[]>()
  for (const u of units) {
    if (u.parentCode) {
      if (!byCode.has(u.parentCode)) error(u.code, `Parent ${u.parentCode} missing`)
      childrenOf.set(u.parentCode, [...(childrenOf.get(u.parentCode) ?? []), u])
    }
  }

  // 2. Coordinates: INEC point if plausible, else estimated from the nearest level with known points.
  const coordStats = { inec: 0, estimated: 0, outliers: 0, notFetched: 0, returnedNone: 0 }
  const known = new Map<string, LngLat>()
  for (const pu of pus) {
    if (!inputs.coords.has(pu.code)) {
      coordStats.notFetched++
      continue
    }
    const p = inputs.coords.get(pu.code)
    if (!p) {
      coordStats.returnedNone++
      continue
    }
    const state = pu.code.slice(0, 2)
    const box = inputs.stateBoxes?.get(state)
    const ok = box ? inBox(p, box, STATE_BOX_MARGIN) : inBox(p, NW_BBOX)
    if (!ok) {
      coordStats.outliers++
      warn(pu.code, `Coordinate ${p.lat},${p.lng} is outside ${box ? `state ${state}'s bounding box` : 'the NW bounding box'}; using an estimate`)
      continue
    }
    known.set(pu.code, p)
  }

  const knownUnder = (code: string) => pus.filter(p => p.code.startsWith(`${code}/`) && known.has(p.code)).map(p => known.get(p.code)!)
  const centroidCache = new Map<string, LngLat | null>()
  const centroid = (code: string) => {
    if (!centroidCache.has(code)) centroidCache.set(code, mean(knownUnder(code)))
    return centroidCache.get(code)!
  }

  // Ward polygon interior points (GRID3, via pnpm geo:build); their mean stands in for an LGA/state.
  const wardPoints = inputs.wardPoints ?? new Map<string, LngLat>()
  const polygonPoint = (code: string) =>
    wardPoints.get(code) ?? mean([...wardPoints].filter(([w]) => w.startsWith(`${code}/`)).map(([, p]) => p))

  /** Best estimate for a ward/LGA/state: its known PU points, else its polygon point(s), else its parent's. */
  const estimate = (code: string): LngLat | null => {
    const parent = parentCode(code)
    return centroid(code) ?? polygonPoint(code) ?? (parent ? estimate(parent) : null)
  }

  for (const pu of pus) {
    const own = known.get(pu.code)
    if (own) {
      pu.location = own
      coordStats.inec++
      continue
    }
    pu.location = estimate(pu.parentCode!)
    pu.locationEstimated = true
    coordStats.estimated++
  }
  for (const u of units.filter(x => x.level !== 'pu')) {
    const c = centroid(u.code)
    u.location = c ?? estimate(u.code)
    // A centroid of real INEC points is a genuine location for an area; anything else is an estimate.
    u.locationEstimated = !c
  }

  // GRID3 feature ids from the boundary join.
  for (const u of units) u.boundaryRef = inputs.boundaryRefs?.get(u.code) ?? null

  // 3. Registered voters: PU values from the register; wards/LGAs/states are sums (only when every PU has a value).
  const voterStats = { pus: 0, missing: 0 }
  if (inputs.voters) {
    for (const [code, n] of inputs.voters) {
      if (!puCodes.has(code)) warn(code, 'Registered-voters row for an unknown PU code')
      else if (!Number.isInteger(n) || n < 0) error(code, `Invalid registered voters: ${n}`)
    }
    for (const pu of pus) {
      const n = inputs.voters.get(pu.code)
      if (n !== undefined && Number.isInteger(n) && n >= 0) {
        pu.registeredVoters = n
        voterStats.pus++
      }
      else {
        voterStats.missing++
      }
    }
    for (const level of ['ward', 'lga', 'state'] as const) {
      for (const u of units.filter(x => x.level === level)) {
        const kids = childrenOf.get(u.code) ?? []
        u.registeredVoters = kids.every(k => k.registeredVoters !== null)
          ? kids.reduce((a, k) => a + k.registeredVoters!, 0)
          : null
      }
    }
    if (voterStats.missing > 0) warn('*', `${voterStats.missing} PUs have no registered-voters figure`)
  }
  else {
    voterStats.missing = pus.length
    warn('*', 'No registered-voters file: registered_voters left NULL (see data/SOURCES.md)')
  }

  // 4. Counts per state vs the PRD.
  const states: StateSummary[] = NW_STATES.map((s) => {
    const under = (level: UnitLevel) => units.filter(u => u.level === level && u.code.startsWith(`${s.code}/`)).length
    const summary = {
      code: s.code,
      name: s.name,
      lgas: under('lga'),
      wards: under('ward'),
      pus: under('pu'),
      expected: EXPECTED_COUNTS[s.code]!,
    }
    for (const k of ['lgas', 'wards', 'pus'] as const) {
      if (summary[k] !== summary.expected[k]) {
        warn(s.code, `${s.name}: ${summary[k]} ${k}, PRD expects ${summary.expected[k]} — confirm with the human`)
      }
    }
    return summary
  })

  if (coordStats.notFetched > 0) warn('*', `${coordStats.notFetched} PUs have not had their coordinate fetched yet (estimated for now)`)

  // Parents before children, for inserts.
  const order: Record<UnitLevel, number> = { state: 0, lga: 1, ward: 2, pu: 3 }
  units.sort((a, b) => order[a.level] - order[b.level] || a.code.localeCompare(b.code))

  return { units, report: { states, coords: coordStats, voters: voterStats, issues } }
}

/** CSV for data/normalised/units.csv (SEED_DATA §2 columns + location_estimated). */
export function toUnitsCsv(units: NormalisedUnit[]): string {
  const esc = (v: string | number | boolean | null) => {
    if (v === null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = 'code,level,parent_code,name,registered_voters,lat,lng,location_estimated,boundary_ref,source_version'
  const lines = units.map(u => [
    u.code,
    u.level,
    u.parentCode,
    u.name,
    u.registeredVoters,
    u.location?.lat ?? null,
    u.location?.lng ?? null,
    u.locationEstimated,
    u.boundaryRef,
    u.sourceVersion,
  ].map(esc).join(','))
  return `${header}\n${lines.join('\n')}\n`
}
