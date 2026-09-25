// Usage: pnpm db:seed [--dry-run] [--csv-only] [--source-version <v>]
// Imports the INEC PU directory (data/raw/inec) into `units` via data/normalised/units.csv (SEED_DATA §2–3, §6).
// Re-run whenever more data arrives (coordinates, registered voters): it upserts and reports the diff.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import { createDb } from '../server/db/client.ts'
import { normaliseInec, toUnitsCsv, type BBox, type InecPuRow, type LngLat } from './import/inec.ts'
import { ImportRefusedError, writeUnits } from './import/write-units.ts'

config({ quiet: true })

const ROOT = join(import.meta.dirname, '..')
const RAW = join(ROOT, 'data/raw')
const HIERARCHY = join(RAW, 'inec/hierarchy.ndjson')
const COORDS = join(RAW, 'inec/pu-coords.ndjson')
const VOTERS = join(RAW, 'inec/registered-voters.csv')
const GRID3_STATES = join(RAW, 'grid3/states.geojson')
const CROSSWALK = join(ROOT, 'data/normalised/boundary-crosswalk.csv')
const WARD_POINTS = join(ROOT, 'data/normalised/ward-points.csv')
const OUT_CSV = join(ROOT, 'data/normalised/units.csv')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const csvOnly = args.includes('--csv-only')
const sourceVersionArg = args[args.indexOf('--source-version') + 1]

const readNdjson = <T>(file: string): T[] =>
  readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T)

if (!existsSync(HIERARCHY)) {
  console.error(`Missing ${HIERARCHY}. Fetch it first: pnpm data:fetch:inec`)
  process.exit(1)
}

const hierarchy = readNdjson<InecPuRow>(HIERARCHY)

// Latest result per PU; a found coordinate wins over an earlier "none".
const coords = new Map<string, LngLat | null>()
if (existsSync(COORDS)) {
  for (const r of readNdjson<{ code: string, lat: number | null, lng: number | null }>(COORDS)) {
    const point = r.lat === null || r.lng === null ? null : { lat: r.lat, lng: r.lng }
    if (!coords.get(r.code)) coords.set(r.code, point)
  }
}

// Optional: `code,registered_voters` per PU (INEC 2023 register).
let voters: Map<string, number> | undefined
if (existsSync(VOTERS)) {
  voters = new Map()
  const [header, ...lines] = readFileSync(VOTERS, 'utf8').split(/\r?\n/).filter(l => l.trim())
  if (header?.replace(/\s/g, '').toLowerCase() !== 'code,registered_voters') {
    console.error(`${VOTERS}: expected header "code,registered_voters"`)
    process.exit(1)
  }
  for (const line of lines) {
    const [code, n] = line.split(',')
    voters.set(code!.trim(), Number(n))
  }
}

// Per-state bounding boxes from GRID3 state polygons, for the coordinate sanity check.
let stateBoxes: Map<string, BBox> | undefined
if (existsSync(GRID3_STATES)) {
  const NAME_TO_CODE: Record<string, string> = { Jigawa: '17', Kaduna: '18', Kano: '19', Katsina: '20', Kebbi: '21', Sokoto: '33', Zamfara: '36' }
  const fc = JSON.parse(readFileSync(GRID3_STATES, 'utf8')) as { features: { properties: { statename: string }, geometry: { coordinates: unknown } }[] }
  stateBoxes = new Map()
  for (const f of fc.features) {
    const code = NAME_TO_CODE[f.properties.statename]
    if (!code) continue
    const box: BBox = { minLng: 180, minLat: 90, maxLng: -180, maxLat: -90 }
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        const [lng, lat] = c as [number, number]
        box.minLng = Math.min(box.minLng, lng)
        box.maxLng = Math.max(box.maxLng, lng)
        box.minLat = Math.min(box.minLat, lat)
        box.maxLat = Math.max(box.maxLat, lat)
      }
      else if (Array.isArray(c)) {
        c.forEach(walk)
      }
    }
    walk(f.geometry.coordinates)
    stateBoxes.set(code, box)
  }
}

// Optional, from `pnpm geo:build` (task 1.5): GRID3 ids per unit and ward polygon interior points.
const csvRows = (file: string) => readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter(l => l.trim()).map(l => l.split(','))
const boundaryRefs = existsSync(CROSSWALK)
  ? new Map(csvRows(CROSSWALK).map(([code, , ids]) => [code!, ids!]))
  : undefined
const wardPoints = existsSync(WARD_POINTS)
  ? new Map(csvRows(WARD_POINTS).map(([code, lat, lng]) => [code!, { lat: Number(lat), lng: Number(lng) }]))
  : undefined

const sourceVersion = sourceVersionArg && !sourceVersionArg.startsWith('--')
  ? sourceVersionArg
  : `inec-locator-${statSync(HIERARCHY).mtime.toISOString().slice(0, 10)}`

const { units, report } = normaliseInec({ hierarchy, coords, voters, stateBoxes, wardPoints, boundaryRefs, sourceVersion })

// Report.
console.log(`Source version: ${sourceVersion}`)
console.table(report.states.map(s => ({
  state: `${s.code} ${s.name}`,
  lgas: `${s.lgas}/${s.expected.lgas}`,
  wards: `${s.wards}/${s.expected.wards}`,
  pus: `${s.pus}/${s.expected.pus}`,
})))
const c = report.coords
console.log(`Coordinates: ${c.inec} from INEC, ${c.estimated} estimated (${c.notFetched} not fetched, ${c.returnedNone} none from INEC, ${c.outliers} outliers)`)
console.log(boundaryRefs
  ? `Boundaries: ${units.filter(u => u.boundaryRef).length} units linked to GRID3; ${wardPoints?.size ?? 0} ward polygon points`
  : 'Boundaries: none yet (run pnpm geo:build)')
console.log(`Registered voters: ${report.voters.pus} PUs with figures, ${report.voters.missing} missing`)

const errors = report.issues.filter(i => i.severity === 'error')
const warnings = report.issues.filter(i => i.severity === 'warning')
const show = (list: typeof report.issues, max = 15) => {
  for (const i of list.slice(0, max)) console.log(`  [${i.severity}] ${i.code}: ${i.message}`)
  if (list.length > max) console.log(`  … and ${list.length - max} more`)
}
if (warnings.length) {
  console.log(`${warnings.length} warning(s):`)
  show(warnings)
}
if (errors.length) {
  console.error(`${errors.length} error(s) — nothing written:`)
  show(errors, 50)
  process.exit(1)
}

mkdirSync(join(ROOT, 'data/normalised'), { recursive: true })
writeFileSync(OUT_CSV, toUnitsCsv(units))
console.log(`Wrote ${units.length} units to ${OUT_CSV}`)
if (csvOnly) process.exit(0)

const url = process.env.NUXT_DATABASE_URL
if (!url) {
  console.error('NUXT_DATABASE_URL is not set. Copy .env.example to .env or export it.')
  process.exit(1)
}

const { db, client } = createDb(url, { max: 2 })
try {
  const diff = await writeUnits(db, units, { dryRun })
  console.log(`${dryRun ? 'Dry run (nothing written)' : 'Imported'}: ${diff.added} added, ${diff.updated} updated, `
    + `${diff.unchanged} unchanged, ${diff.reactivated} reactivated, ${diff.deactivated} deactivated`)
}
catch (error) {
  if (error instanceof ImportRefusedError) {
    console.error(error.message)
    process.exitCode = 1
  }
  else {
    throw error
  }
}
finally {
  await client.end()
}
