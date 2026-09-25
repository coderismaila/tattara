// Fetch the INEC polling-unit directory for the NW states from INEC's public PU locator
// (https://cvr.inecnigeria.org/pu), the same endpoints its web page calls.
//
//   node scripts/fetch/inec-pus.ts               # hierarchy: states → LGAs → wards → PUs (codes + names)
//   node scripts/fetch/inec-pus.ts --coords      # PU coordinates (one request per PU; resumable)
//   node scripts/fetch/inec-pus.ts --coords --retry-missing   # also re-ask PUs that returned no coordinate
//
// Output (gitignored): data/raw/inec/hierarchy.ndjson, data/raw/inec/pu-coords.ndjson
// Polite by design: one request at a time with a pause, retries with backoff, a lock file so only one
// instance runs, and an immediate stop if INEC answers 403 (blocked) — never retry through a block.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NW_STATE_CODES } from '../../shared/constants/states.ts'

const BASE = 'https://cvr.inecnigeria.org'
const OUT_DIR = join(import.meta.dirname, '../../data/raw/inec')
const HIERARCHY_FILE = join(OUT_DIR, 'hierarchy.ndjson')
const COORDS_FILE = join(OUT_DIR, 'pu-coords.ndjson')
const USER_AGENT = 'Tattara-data-import/0.1 (party supporter registry; contact: project maintainer)'

const LOCK_FILE = join(OUT_DIR, '.fetch.lock')

// 3 parallel requests with 250 ms pauses got this machine blocked (403) after ~30k PUs; stay well below.
const CONCURRENCY = 1
const DELAY_MS = 1500
const MAX_RETRIES = 5

/** INEC refused us (HTTP 403). Stop; resume later from where we left off. */
class BlockedError extends Error {
  override name = 'BlockedError'
}

export interface InecOption {
  id: string
  code: string
  name: string
}

export interface HierarchyRow {
  stateCode: string
  stateName: string
  lgaCode: string
  lgaName: string
  wardCode: string
  wardName: string
  puCode: string
  puName: string
  ids: { state: string, lga: string, ward: string, pu: string }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Parse the locator's `{ "<id>": "<code> - <name>" }` option maps. */
export function parseOptions(payload: unknown): InecOption[] {
  const obj = (Array.isArray(payload) ? payload[0] : payload) as Record<string, string>
  return Object.entries(obj ?? {})
    .filter(([id]) => /^\d+$/.test(id) && id !== '0')
    .map(([id, label]) => {
      const m = /^\s*(\d+)\s*-\s*(.*)$/s.exec(label)
      if (!m) throw new Error(`Unexpected option label: ${JSON.stringify(label)}`)
      return { id, code: m[1]!, name: m[2]!.trim().replace(/\s+/g, ' ') }
    })
}

async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    }
    catch (error) {
      if (error instanceof BlockedError) throw error
      if (attempt >= MAX_RETRIES) throw new Error(`${what} failed after ${attempt} attempts: ${String(error)}`, { cause: error })
      await sleep(1000 * 2 ** attempt)
    }
  }
}

function assertNotBlocked(res: Response) {
  if (res.status === 403) throw new BlockedError('INEC returned 403 Forbidden: this machine is being blocked. Stop and resume later.')
}

async function getJson(path: string): Promise<unknown> {
  return withRetry(path, async () => {
    const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': USER_AGENT, 'X-Requested-With': 'XMLHttpRequest' } })
    assertNotBlocked(res)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
      await sleep(DELAY_MS)
    }
  }))
  return results
}

const q = (field: string, id: string) => `data%5BSearch%5D%5B${field}%5D=${encodeURIComponent(id)}`

async function fetchStates(): Promise<InecOption[]> {
  const html = await withRetry('state list', async () => {
    const res = await fetch(`${BASE}/pu`, { headers: { 'User-Agent': USER_AGENT } })
    assertNotBlocked(res)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  })
  const select = /<select[^>]*id="SearchStateId"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? ''
  const states = [...select.matchAll(/<option value="(\d+)">(\d+)\s*-\s*([^<]+)/g)]
    .map(m => ({ id: m[1]!, code: m[2]!, name: m[3]!.trim() }))
  const nw = states.filter(s => (NW_STATE_CODES as readonly string[]).includes(s.code))
  if (nw.length !== NW_STATE_CODES.length) {
    throw new Error(`Expected ${NW_STATE_CODES.length} NW states on the locator page, found ${nw.length}`)
  }
  return nw
}

async function fetchHierarchy() {
  mkdirSync(OUT_DIR, { recursive: true })
  const states = await fetchStates()
  const rows: HierarchyRow[] = []

  for (const state of states) {
    const lgas = parseOptions(await getJson(`/PublicApi/lgas/1/Search?${q('state_id', state.id)}`))
    const wardsByLga = await mapLimit(lgas, CONCURRENCY, async lga =>
      ({ lga, wards: parseOptions(await getJson(`/PublicApi/wards/1/Search?${q('local_government_id', lga.id)}`)) }))

    const wardJobs = wardsByLga.flatMap(({ lga, wards }) => wards.map(ward => ({ lga, ward })))
    const pusByWard = await mapLimit(wardJobs, CONCURRENCY, async ({ lga, ward }) =>
      ({ lga, ward, pus: parseOptions(await getJson(`/PublicApi/pus/1/Search?${q('registration_area_id', ward.id)}`)) }))

    let count = 0
    for (const { lga, ward, pus } of pusByWard) {
      for (const pu of pus) {
        rows.push({
          stateCode: state.code,
          stateName: state.name,
          lgaCode: lga.code.padStart(2, '0'),
          lgaName: lga.name,
          wardCode: ward.code.padStart(2, '0'),
          wardName: ward.name,
          puCode: pu.code.padStart(3, '0'),
          puName: pu.name,
          ids: { state: state.id, lga: lga.id, ward: ward.id, pu: pu.id },
        })
        count++
      }
    }
    console.log(`${state.code} ${state.name}: ${lgas.length} LGAs, ${wardJobs.length} wards, ${count} PUs`)
  }

  writeFileSync(HIERARCHY_FILE, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(`Wrote ${rows.length} PUs to ${HIERARCHY_FILE}`)
}

/** The locator answers a PU search with a redirect to `maps.google.com/?q=<lat>,<lng>`. */
export function parseLocatorRedirect(location: string | null): { lat: number, lng: number } | null {
  const m = /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(location ?? '')
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

async function newSession(): Promise<string> {
  const res = await fetch(`${BASE}/pu`, { headers: { 'User-Agent': USER_AGENT } })
  assertNotBlocked(res)
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

interface CoordRow {
  code: string
  lat: number | null
  lng: number | null
}

/** Latest result per PU code; a found coordinate wins over an earlier "missing". */
function readCoords(): Map<string, CoordRow> {
  const byCode = new Map<string, CoordRow>()
  if (!existsSync(COORDS_FILE)) return byCode
  for (const line of readFileSync(COORDS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const row = JSON.parse(line) as CoordRow
    const prev = byCode.get(row.code)
    if (!prev || prev.lat === null) byCode.set(row.code, row)
  }
  return byCode
}

async function fetchCoords(retryMissing: boolean) {
  if (!existsSync(HIERARCHY_FILE)) throw new Error('Run the hierarchy fetch first.')
  const rows = readFileSync(HIERARCHY_FILE, 'utf8').trim().split('\n').map(l => JSON.parse(l) as HierarchyRow)
  const known = readCoords()
  const todo = rows.filter((r) => {
    const prev = known.get(`${r.stateCode}/${r.lgaCode}/${r.wardCode}/${r.puCode}`)
    return !prev || (retryMissing && prev.lat === null)
  })
  const missing = [...known.values()].filter(r => r.lat === null).length
  console.log(`Coordinates: ${known.size - missing} found, ${missing} missing, ${todo.length} to fetch`)

  let cookie = await newSession()
  let fetched = 0
  await mapLimit(todo, CONCURRENCY, async (r) => {
    const code = `${r.stateCode}/${r.lgaCode}/${r.wardCode}/${r.puCode}`
    const body = new URLSearchParams({
      '_method': 'POST',
      'data[Search][state_id]': r.ids.state,
      'data[Search][local_government_id]': r.ids.lga,
      'data[Search][registration_area_id]': r.ids.ward,
      'data[Search][polling_unit_id]': r.ids.pu,
    })
    const point = await withRetry(code, async () => {
      const res = await fetch(`${BASE}/pu_locator/index`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, 'Cookie': cookie, 'Referer': `${BASE}/pu`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      assertNotBlocked(res)
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (res.status !== 302) {
        cookie = await newSession()
        throw new Error(`HTTP ${res.status} (session refreshed)`)
      }
      return parseLocatorRedirect(res.headers.get('location'))
    })
    appendFileSync(COORDS_FILE, JSON.stringify({ code, ...(point ?? { lat: null, lng: null }) }) + '\n')
    if (++fetched % 500 === 0) console.log(`  ${fetched}/${todo.length}`)
  })
  console.log(`Coordinates complete: ${fetched} fetched this run.`)
}

if (import.meta.main) {
  mkdirSync(OUT_DIR, { recursive: true })
  // One instance at a time: two parallel runs double the load on INEC (that is how we got blocked once).
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' })
  }
  catch {
    console.error(`Another fetch holds ${LOCK_FILE} (pid ${readFileSync(LOCK_FILE, 'utf8')}). If it is not running, delete the file.`)
    process.exit(1)
  }
  try {
    if (process.argv.includes('--coords')) await fetchCoords(process.argv.includes('--retry-missing'))
    else await fetchHierarchy()
  }
  catch (error) {
    if (error instanceof BlockedError) {
      console.error(error.message)
      process.exitCode = 2
    }
    else {
      throw error
    }
  }
  finally {
    rmSync(LOCK_FILE, { force: true })
  }
}
