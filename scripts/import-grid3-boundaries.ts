// Usage: pnpm geo:build
// Boundary join (SEED_DATA §4): match GRID3 states/LGAs/wards to INEC units, simplify, and write public/geo/*.
// Also writes the crosswalk + ward interior points that `pnpm db:seed` uses (boundary_ref, location fallback).
//
// Outputs
//   public/geo/nw-states.geojson, nw-lgas.geojson, wards/{stateCode}.geojson   (served; committed)
//   data/crosswalk/unmatched.csv   units/features the human must resolve in data/crosswalk/manual.csv (committed)
//   data/crosswalk/review.csv      accepted matches worth a look (spatial-only, or names the points disagree with)
//   data/normalised/boundary-crosswalk.csv, ward-points.csv, reports/pu-outside-ward.csv   (gitignored)
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mapshaper from 'mapshaper'
import { loadGrid3Features, loadInecUnits } from './boundaries/load.ts'
import { matchBoundaries, type BoundaryFeature, type BoundaryMatch } from './boundaries/match.ts'

const ROOT = join(import.meta.dirname, '..')
const GEO = join(ROOT, 'public/geo')
const CROSSWALK = join(ROOT, 'data/crosswalk')
const NORMALISED = join(ROOT, 'data/normalised')

/** Simplification (mapshaper `-simplify <pct> keep-shapes`), tuned so outputs meet the size targets below. */
const SIMPLIFY = '3%'
const PRECISION = '0.0001' // ≈ 11 m
const TARGET_KB = { states: 150, lgas: 600, wardsPerState: 800 }

const csv = (rows: (string | number | boolean | null | undefined)[][]) =>
  `${rows.map(r => r.map((v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n')}\n`

function readManual(): Map<string, string> {
  const file = join(CROSSWALK, 'manual.csv')
  const map = new Map<string, string>()
  if (!existsSync(file)) return map
  const [, ...lines] = readFileSync(file, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue
    const [id, code] = line.split(',').map(s => s.trim())
    if (id && code) map.set(id, code)
  }
  return map
}

async function simplify(features: object[], extraFields: string[]) {
  const input = { type: 'FeatureCollection', features }
  const out = await mapshaper.applyCommands(
    `-i in.json -dissolve2 code copy-fields=${['name', ...extraFields].join(',')} -simplify ${SIMPLIFY} keep-shapes -o precision=${PRECISION} format=geojson out.json`,
    { 'in.json': input },
  )
  return JSON.parse(String(out['out.json'])) as { type: string, features: { properties: Record<string, string> }[] }
}

const units = loadInecUnits()
const features = loadGrid3Features()
const featureById = new Map(features.map(f => [f.id, f]))
const unitByCode = new Map(units.map(u => [u.code, u]))
const result = matchBoundaries({ units, features, manual: readManual() })

// 1. Report + crosswalk files.
mkdirSync(CROSSWALK, { recursive: true })
mkdirSync(join(NORMALISED, 'reports'), { recursive: true })

const count = (level: string) => result.matches.filter(m => m.level === level).length
const total = (level: string) => units.filter(u => u.level === level).length
console.log(`Matched: states ${count('state')}/${total('state')}, LGAs ${count('lga')}/${total('lga')}, wards ${count('ward')}/${total('ward')}`)
const methods: Record<string, number> = {}
for (const m of result.matches) methods[m.method] = (methods[m.method] ?? 0) + 1
console.log('By method:', methods)

writeFileSync(join(NORMALISED, 'boundary-crosswalk.csv'), csv([
  ['code', 'level', 'grid3_ids', 'method', 'name_score', 'spatial_share', 'review', 'note'],
  ...result.matches.map(m => [m.code, m.level, m.featureIds.join(';'), m.method, m.nameScore, m.spatialShare, m.review, m.note]),
]))

writeFileSync(join(CROSSWALK, 'unmatched.csv'), csv([
  ['kind', 'code_or_grid3_id', 'level', 'name', 'reason', 'candidates'],
  ...result.unresolved.map(u => ['inec_unit', u.code, u.level, u.name, u.reason,
    u.candidates.map(c => `${c.id} "${c.name}" name=${c.nameScore ?? '-'} spatial=${c.spatialShare ?? '-'}`).join(' | ')]),
  ...result.unmatchedFeatures.map(f => ['grid3_feature', f.id, f.level, f.name, `state ${f.stateCode}${f.lgaName ? `, LGA ${f.lgaName}` : ''}`, '']),
]))

const reviews = result.matches.filter(m => m.review)
writeFileSync(join(CROSSWALK, 'review.csv'), csv([
  ['code', 'level', 'inec_name', 'grid3_ids', 'grid3_names', 'method', 'name_score', 'spatial_share', 'note'],
  ...reviews.map(m => [m.code, m.level, unitByCode.get(m.code)?.name, m.featureIds.join(';'),
    m.featureIds.map(id => featureById.get(id)?.name).join(';'), m.method, m.nameScore, m.spatialShare, m.note]),
]))

writeFileSync(join(NORMALISED, 'reports/pu-outside-ward.csv'), csv([
  ['pu_code', 'ward_code'],
  ...result.puOutsideWard.map(p => [p.code, p.wardCode]),
]))

console.log(`Unresolved: ${result.unresolved.length} INEC units, ${result.unmatchedFeatures.length} GRID3 features → data/crosswalk/unmatched.csv`)
console.log(`For review: ${reviews.length} accepted matches → data/crosswalk/review.csv`)
console.log(`INEC PU points outside their matched ward polygon: ${result.puOutsideWard.length} (data/normalised/reports/pu-outside-ward.csv)`)

// 2. Simplified GeoJSON for the map, keyed by INEC code.
const toFeatures = (level: BoundaryMatch['level']) => result.matches
  .filter(m => m.level === level)
  .flatMap(m => m.featureIds.map((id) => {
    const f = featureById.get(id) as BoundaryFeature
    return { type: 'Feature', geometry: f.geometry, properties: { code: m.code, name: unitByCode.get(m.code)!.name, state: m.code.slice(0, 2) } }
  }))

rmSync(join(GEO, 'wards'), { recursive: true, force: true })
mkdirSync(join(GEO, 'wards'), { recursive: true })

const sizes: { file: string, kb: number, target: number }[] = []
const write = (rel: string, data: object, target: number) => {
  const file = join(GEO, rel)
  writeFileSync(file, JSON.stringify(data))
  sizes.push({ file: `public/geo/${rel}`, kb: Math.round(statSync(file).size / 1024), target })
}

write('nw-states.geojson', await simplify(toFeatures('state'), ['state']), TARGET_KB.states)
write('nw-lgas.geojson', await simplify(toFeatures('lga'), ['state']), TARGET_KB.lgas)

// Simplify all NW wards together so shared borders stay shared, then split per state.
const wards = await simplify(toFeatures('ward'), ['state'])
for (const stateCode of [...new Set(wards.features.map(f => f.properties.state!))].sort()) {
  write(`wards/${stateCode}.geojson`, { type: 'FeatureCollection', features: wards.features.filter(f => f.properties.state === stateCode) }, TARGET_KB.wardsPerState)
}

console.table(sizes.map(s => ({ file: s.file, KB: s.kb, target: `< ${s.target}`, ok: s.kb < s.target ? 'yes' : 'NO' })))

// 3. Ward interior points (from full-resolution polygons) for the importer's location fallback.
const inner = await mapshaper.applyCommands(
  '-i in.json -dissolve2 code -points inner -o format=geojson out.json',
  { 'in.json': { type: 'FeatureCollection', features: toFeatures('ward') } },
)
const points = JSON.parse(String(inner['out.json'])) as { features: { geometry: { coordinates: [number, number] }, properties: { code: string } }[] }
writeFileSync(join(NORMALISED, 'ward-points.csv'), csv([
  ['code', 'lat', 'lng'],
  ...points.features.map(p => [p.properties.code, p.geometry.coordinates[1].toFixed(6), p.geometry.coordinates[0].toFixed(6)]),
]))
console.log(`Wrote ${points.features.length} ward interior points. Next: pnpm db:seed (uses them + boundary_ref).`)
