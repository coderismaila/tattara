// Match GRID3 boundary features to INEC units (SEED_DATA §4). Pure: no file or DB access.
//
// States: by name. LGAs: Jaro-Winkler ≥ NAME_THRESHOLD on normalised names within the state.
// LGAs and wards are cross-checked by a spatial vote: which candidate polygon holds most of the unit's INEC-coordinate
// PUs. Names ≥ STRONG_NAME win over a disagreeing vote (flagged); weaker names that disagree go to the human; with no
// name match, a spatial majority is accepted (flagged). A manual crosswalk (grid3 id → code) overrides everything.
import type { UnitLevel } from '../../shared/constants/enums.ts'
import { normaliseName } from '../../shared/utils/text.ts'
import type { NormalisedUnit } from '../import/inec.ts'
import { bboxOf, inBBox, pointInGeometry, type BBox, type PolygonalGeometry } from './geometry.ts'

export const NAME_THRESHOLD = 0.92
/** A name this close is trusted over a disagreeing spatial vote (flagged for review instead). */
export const STRONG_NAME = 0.97
/** Spatial vote needs this many INEC points in the ward and this share inside one polygon. */
export const SPATIAL_MIN_POINTS = 3
export const SPATIAL_MIN_SHARE = 0.6

export interface BoundaryFeature {
  /** Stable id used as units.boundary_ref, e.g. `grid3-ward-v3:151`. */
  id: string
  level: Exclude<UnitLevel, 'pu'>
  /** INEC state code this feature belongs to (resolved from the GRID3 state name). */
  stateCode: string
  name: string
  altNames: string[]
  /** For wards: the GRID3 LGA name on the ward record. */
  lgaName?: string
  geometry: PolygonalGeometry
}

export type MatchMethod = 'manual' | 'name' | 'name+spatial' | 'spatial'

export interface BoundaryMatch {
  code: string
  level: Exclude<UnitLevel, 'pu'>
  featureIds: string[]
  method: MatchMethod
  nameScore: number | null
  spatialShare: number | null
  /** Accepted but worth a human look (spatial-only matches, or names that the points disagree with). */
  review: boolean
  note?: string
}

export interface Unresolved {
  code: string
  level: Exclude<UnitLevel, 'pu'>
  name: string
  reason: string
  candidates: { id: string, name: string, nameScore: number | null, spatialShare: number | null }[]
}

export interface MatchResult {
  matches: BoundaryMatch[]
  unresolved: Unresolved[]
  unmatchedFeatures: BoundaryFeature[]
  /** INEC PU coordinates that fall outside their matched ward polygon (quality signal only). */
  puOutsideWard: { code: string, wardCode: string }[]
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatched = new Array<boolean>(a.length).fill(false)
  const bMatched = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (bMatched[j] || a[i] !== b[j]) continue
      aMatched[i] = bMatched[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let transpositions = 0
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatched[i]) continue
    while (!bMatched[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

/** Best similarity between two place names, also comparing with spaces removed ("DAN BATTA" vs "Danbatta"). */
export function nameScore(a: string, b: string): number {
  const na = matchKey(a)
  const nb = matchKey(b)
  return Math.max(jaroWinkler(na, nb), jaroWinkler(na.replace(/ /g, ''), nb.replace(/ /g, '')))
}

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' }

/** normaliseName + Roman numerals as digits ("DANGALADIMA II" ≡ "Dangaladima 2"). */
export function matchKey(name: string): string {
  return normaliseName(name).split(' ').map(t => ROMAN[t] ?? t).join(' ')
}

/** Alternative names count slightly less, so a unit whose primary name matches wins a tie. */
const ALT_NAME_PENALTY = 0.01

const bestName = (unit: NormalisedUnit, f: BoundaryFeature) =>
  Math.max(nameScore(unit.name, f.name), ...f.altNames.map(n => nameScore(unit.name, n) - ALT_NAME_PENALTY))

export interface MatchInputs {
  units: NormalisedUnit[]
  features: BoundaryFeature[]
  /** Manual crosswalk: feature id → unit code (data/crosswalk/manual.csv). */
  manual?: Map<string, string>
}

export function matchBoundaries({ units, features, manual = new Map() }: MatchInputs): MatchResult {
  const byCode = new Map(units.map(u => [u.code, u]))
  const featureById = new Map(features.map(f => [f.id, f]))
  const taken = new Set<string>()
  const matches: BoundaryMatch[] = []
  const unresolved: Unresolved[] = []
  const matchedCode = new Map<string, BoundaryMatch>()

  const accept = (m: BoundaryMatch) => {
    m.featureIds.forEach(id => taken.add(id))
    matches.push(m)
    matchedCode.set(m.code, m)
  }

  // 0. Manual overrides (several features may map to one code, e.g. a split ward).
  const manualByCode = new Map<string, string[]>()
  for (const [id, code] of manual) {
    const f = featureById.get(id)
    const u = byCode.get(code)
    if (!f || !u || u.level !== f.level) continue
    manualByCode.set(code, [...(manualByCode.get(code) ?? []), id])
  }
  for (const [code, ids] of manualByCode) {
    accept({ code, level: byCode.get(code)!.level as BoundaryMatch['level'], featureIds: ids, method: 'manual', nameScore: null, spatialShare: null, review: false })
  }

  // Real (non-estimated) INEC PU points, grouped by ward.
  const realPoints = new Map<string, { code: string, lng: number, lat: number }[]>()
  for (const u of units) {
    if (u.level !== 'pu' || u.locationEstimated || !u.location) continue
    const ward = u.parentCode!
    realPoints.set(ward, [...(realPoints.get(ward) ?? []), { code: u.code, ...u.location }])
  }
  const pointsUnder = (code: string) => [...realPoints].filter(([w]) => w.startsWith(`${code}/`) || w === code).flatMap(([, p]) => p)

  const boxes = new Map<string, BBox>(features.map(f => [f.id, bboxOf(f.geometry)]))

  const wardLayerLgas = new Map<string, string[]>()
  for (const f of features) {
    if (f.level !== 'ward' || !f.lgaName) continue
    const list = wardLayerLgas.get(f.stateCode) ?? []
    if (!list.includes(f.lgaName)) list.push(f.lgaName)
    wardLayerLgas.set(f.stateCode, list)
  }
  const wardLayerLgaFor = (stateCode: string, lgaName: string) =>
    (wardLayerLgas.get(stateCode) ?? []).map(n => ({ n, s: nameScore(lgaName, n) })).sort((a, b) => b.s - a.s)[0]?.n
  /** Which candidate polygon holds most of the unit's real PU points (candidates only: same state, or same LGA for wards). */
  const spatialVote = (code: string, pool: BoundaryFeature[]) => {
    const pts = pointsUnder(code)
    if (pts.length < SPATIAL_MIN_POINTS) return null
    const tally = new Map<string, number>()
    for (const p of pts) {
      const hit = pool.find(f => inBBox(p, boxes.get(f.id)!) && pointInGeometry(p, f.geometry))
      if (hit) tally.set(hit.id, (tally.get(hit.id) ?? 0) + 1)
    }
    const [topId, n] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? []
    return topId ? { id: topId, share: n! / pts.length } : null
  }

  for (const level of ['state', 'lga', 'ward'] as const) {
    const levelUnits = units.filter(u => u.level === level && !matchedCode.has(u.code))
    const pending: { unit: NormalisedUnit, best?: { f: BoundaryFeature, score: number }, spatial: { id: string, share: number } | null, candidates: Unresolved['candidates'] }[] = []

    for (const unit of levelUnits) {
      const stateCode = unit.code.slice(0, 2)
      let pool = features.filter(f => f.level === level && f.stateCode === stateCode)
      if (level === 'ward') {
        // Only wards of this LGA. GRID3's ward layer spells some LGAs differently from its LGA layer
        // ("Garum Mallam" vs "Garun Malam"), so pick the ward-layer LGA name closest to the matched GRID3 LGA
        // (or to the INEC name if the LGA is unmatched) rather than applying a threshold.
        const lgaMatch = matchedCode.get(unit.parentCode!)
        const grid3Lga = lgaMatch ? featureById.get(lgaMatch.featureIds[0]!) : undefined
        const lgaName = grid3Lga?.name ?? byCode.get(unit.parentCode!)!.name
        const wardLayerLga = wardLayerLgaFor(stateCode, lgaName)
        pool = pool.filter(f => f.lgaName === wardLayerLga)
      }
      const scored = pool.filter(f => !taken.has(f.id)).map(f => ({ f, score: bestName(unit, f) })).sort((a, b) => b.score - a.score)
      const spatial = level === 'state' ? null : spatialVote(unit.code, pool)
      pending.push({
        unit,
        best: scored[0],
        spatial,
        candidates: scored.slice(0, 3).map(s => ({ id: s.f.id, name: s.f.name, nameScore: round3(s.score), spatialShare: spatial?.id === s.f.id ? round3(spatial.share) : null })),
      })
    }

    // Most confident first, so a feature goes to its best claimant.
    pending.sort((a, b) => (b.best?.score ?? 0) - (a.best?.score ?? 0))
    for (const p of pending) {
      const { unit, best, spatial } = p
      const nameOk = !!best && best.score >= NAME_THRESHOLD && !taken.has(best.f.id)
      const spatialOk = !!spatial && spatial.share >= SPATIAL_MIN_SHARE && !taken.has(spatial.id)
      const lvl = level as BoundaryMatch['level']
      const fail = (reason: string) => {
        const extra = spatial && !p.candidates.some(c => c.id === spatial.id)
          ? [{ id: spatial.id, name: featureById.get(spatial.id)!.name, nameScore: null, spatialShare: round3(spatial.share) }]
          : []
        unresolved.push({ code: unit.code, level: lvl, name: unit.name, reason, candidates: [...p.candidates, ...extra] })
      }

      const nameMatch = (review: boolean, note?: string) => {
        const agree = spatialOk && spatial!.id === best!.f.id
        accept({ code: unit.code, level: lvl, featureIds: [best!.f.id], method: agree ? 'name+spatial' : 'name', nameScore: round3(best!.score), spatialShare: spatial ? round3(spatial.share) : null, review, ...(note && { note }) })
      }
      const disagreement = () => `${Math.round(spatial!.share * 100)}% of its PUs lie in ${featureById.get(spatial!.id)!.name}`

      if (nameOk && (!spatialOk || spatial!.id === best!.f.id)) {
        nameMatch(false)
      }
      else if (nameOk && spatialOk && best!.score >= STRONG_NAME) {
        // Exact names beat point positions (INEC points and GRID3's operational lines are both imperfect).
        nameMatch(true, `Name match kept, but ${disagreement()}`)
      }
      else if (nameOk && spatialOk) {
        fail(`Name points to ${best!.f.name} (${round3(best!.score)}) but ${disagreement()}`)
      }
      else if (spatialOk) {
        accept({ code: unit.code, level: lvl, featureIds: [spatial!.id], method: 'spatial', nameScore: best ? round3(best.score) : null, spatialShare: round3(spatial!.share), review: true, note: `No name match; ${Math.round(spatial!.share * 100)}% of its PUs lie in ${featureById.get(spatial!.id)!.name}` })
      }
      else {
        fail(best && taken.has(best.f.id) ? `Best name match ${best.f.name} already taken` : 'No name match ≥ 0.92 and no spatial majority')
      }
    }
  }

  // Quality signal: real PU points outside their own ward's polygon.
  const puOutsideWard: MatchResult['puOutsideWard'] = []
  for (const [wardCode, pts] of realPoints) {
    const m = matchedCode.get(wardCode)
    if (!m) continue
    for (const p of pts) {
      const inside = m.featureIds.some(id => pointInGeometry(p, featureById.get(id)!.geometry))
      if (!inside) puOutsideWard.push({ code: p.code, wardCode })
    }
  }

  return {
    matches: matches.sort((a, b) => a.code.localeCompare(b.code)),
    unresolved: unresolved.sort((a, b) => a.code.localeCompare(b.code)),
    unmatchedFeatures: features.filter(f => !taken.has(f.id)),
    puOutsideWard,
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
