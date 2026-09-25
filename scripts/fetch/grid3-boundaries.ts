// Fetch GRID3 Nigeria operational boundaries (states, LGAs, wards) for the 7 NW states as GeoJSON,
// from GRID3's public ArcGIS feature services. Also saves each item's licence/credits.
//
//   node scripts/fetch/grid3-boundaries.ts [--force]   (skips layers already on disk unless --force)
//
// Output (gitignored): data/raw/grid3/{states,lgas,wards}.geojson + {layer}.meta.json
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NW_STATES } from '../../shared/constants/states.ts'

const SERVICES = 'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services'
const OUT_DIR = join(import.meta.dirname, '../../data/raw/grid3')

const NW_NAMES = NW_STATES.map(s => s.name)

const LAYERS = [
  { key: 'states', itemId: 'c41532b720504f4799fe20438b7e3b7f', service: 'NGA_State_Boundaries_V2', stateField: 'statename', orderBy: 'FID', page: 50 },
  { key: 'lgas', itemId: '2bb616a49ee84f409427cc2143787113', service: 'NGA_LGA_Boundaries_2', stateField: 'statename', orderBy: 'FID', page: 200 },
  // Ward polygons are full resolution (~20 KB each): small pages avoid dropped connections.
  { key: 'wards', itemId: '45cd2ef592094d12aca43113a90a6054', service: 'GRID3_NGA_operational_wards_v3_0', stateField: 'state', orderBy: 'OBJECTID', page: 200 },
] as const

interface FeatureCollection {
  type: 'FeatureCollection'
  features: unknown[]
  exceededTransferLimit?: boolean
  properties?: { exceededTransferLimit?: boolean }
}

/** Retries HTTP errors and network/body failures (ECONNRESET, truncated responses). */
async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await (res.json() as Promise<T>)
    }
    catch (error) {
      if (attempt >= 6) throw new Error(`${url} failed after ${attempt} attempts: ${String(error)}`, { cause: error })
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
}

async function fetchLayer(layer: typeof LAYERS[number]) {
  const where = `${layer.stateField} IN (${NW_NAMES.map(n => `'${n}'`).join(',')})`
  const features: unknown[] = []
  for (let offset = 0; ; offset += layer.page) {
    const params = new URLSearchParams({
      where,
      outFields: '*',
      outSR: '4326',
      orderByFields: layer.orderBy,
      resultOffset: String(offset),
      resultRecordCount: String(layer.page),
      f: 'geojson',
    })
    const page = await getJson<FeatureCollection>(`${SERVICES}/${layer.service}/FeatureServer/0/query?${params}`)
    features.push(...page.features)
    const more = page.exceededTransferLimit ?? page.properties?.exceededTransferLimit
    if (page.features.length === 0 || (!more && page.features.length < layer.page)) break
  }

  const item = await getJson<Record<string, unknown>>(`https://www.arcgis.com/sharing/rest/content/items/${layer.itemId}?f=json`)
  const meta = {
    title: item.title,
    itemId: layer.itemId,
    service: `${SERVICES}/${layer.service}/FeatureServer/0`,
    modified: new Date(item.modified as number).toISOString(),
    fetchedAt: new Date().toISOString(),
    licence: String(item.licenseInfo ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    credits: item.accessInformation,
    featureCount: features.length,
  }

  writeFileSync(join(OUT_DIR, `${layer.key}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }))
  writeFileSync(join(OUT_DIR, `${layer.key}.meta.json`), JSON.stringify(meta, null, 2))
  console.log(`${layer.key}: ${features.length} features (${meta.title}, modified ${meta.modified.slice(0, 10)})`)
}

mkdirSync(OUT_DIR, { recursive: true })
const force = process.argv.includes('--force')
for (const layer of LAYERS) {
  if (!force && existsSync(join(OUT_DIR, `${layer.key}.meta.json`))) {
    console.log(`${layer.key}: already fetched (use --force to refetch)`)
    continue
  }
  await fetchLayer(layer)
}
