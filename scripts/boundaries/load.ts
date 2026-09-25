// Load raw inputs for the boundary join: INEC units (via the importer's normaliser) and GRID3 features.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NW_STATES } from '../../shared/constants/states.ts'
import { normaliseInec, type InecPuRow, type LngLat, type NormalisedUnit } from '../import/inec.ts'
import type { PolygonalGeometry } from './geometry.ts'
import type { BoundaryFeature } from './match.ts'

const ROOT = join(import.meta.dirname, '../..')
export const RAW = join(ROOT, 'data/raw')

const readNdjson = <T>(file: string): T[] =>
  readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T)

/** INEC units with INEC coordinates (estimated ones flagged), exactly as the importer builds them. */
export function loadInecUnits(): NormalisedUnit[] {
  const hierarchyFile = join(RAW, 'inec/hierarchy.ndjson')
  if (!existsSync(hierarchyFile)) throw new Error(`Missing ${hierarchyFile}. Run pnpm data:fetch:inec`)
  const coords = new Map<string, LngLat | null>()
  const coordsFile = join(RAW, 'inec/pu-coords.ndjson')
  if (existsSync(coordsFile)) {
    for (const r of readNdjson<{ code: string, lat: number | null, lng: number | null }>(coordsFile)) {
      const p = r.lat === null || r.lng === null ? null : { lat: r.lat, lng: r.lng }
      if (!coords.get(r.code)) coords.set(r.code, p)
    }
  }
  return normaliseInec({ hierarchy: readNdjson<InecPuRow>(hierarchyFile), coords, sourceVersion: 'boundary-join' }).units
}

interface RawFeature {
  properties: Record<string, unknown>
  geometry: PolygonalGeometry
}

const STATE_CODE_BY_NAME = new Map(NW_STATES.map(s => [s.name.toLowerCase(), s.code]))
const stateCode = (name: unknown) => {
  const code = STATE_CODE_BY_NAME.get(String(name).trim().toLowerCase())
  if (!code) throw new Error(`GRID3 feature in unknown state "${String(name)}"`)
  return code
}
const altNames = (v: unknown) => String(v ?? '').split(/[;,|]/).map(s => s.trim()).filter(Boolean)

/** GRID3 states, LGAs and wards (v3.0) as BoundaryFeatures with stable ids. */
export function loadGrid3Features(): BoundaryFeature[] {
  const read = (layer: string) => {
    const file = join(RAW, `grid3/${layer}.geojson`)
    if (!existsSync(file)) throw new Error(`Missing ${file}. Run pnpm data:fetch:grid3`)
    return (JSON.parse(readFileSync(file, 'utf8')) as { features: RawFeature[] }).features
  }
  return [
    ...read('states').map(f => ({
      id: `grid3-state:${String(f.properties.globalid)}`,
      level: 'state' as const,
      stateCode: stateCode(f.properties.statename),
      name: String(f.properties.statename),
      altNames: [],
      geometry: f.geometry,
    })),
    ...read('lgas').map(f => ({
      id: `grid3-lga:${String(f.properties.globalid)}`,
      level: 'lga' as const,
      stateCode: stateCode(f.properties.statename),
      name: String(f.properties.lganame),
      altNames: [],
      geometry: f.geometry,
    })),
    ...read('wards').map(f => ({
      id: `grid3-ward-v3:${String(f.properties.OBJECTID)}`,
      level: 'ward' as const,
      stateCode: stateCode(f.properties.state),
      name: String(f.properties.ward),
      altNames: altNames(f.properties.ward_alt_names),
      lgaName: String(f.properties.lga),
      geometry: f.geometry,
    })),
  ]
}
