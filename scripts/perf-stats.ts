// Usage: pnpm perf:stats   (task 6.1 AC: /stats/children/all < 300 ms p95 on 41,671 PUs × 5M supporters)
// Builds a throwaway database with the NW region's shape (7 states, 186 LGAs, 2,003 wards, 41,671 PUs), fills pu_stats
// with counters summing to 5,000,000 supporters (the stats only read pu_stats, so supporter rows aren't needed), adds
// registered voters (80% of PUs) and targets, then times the uncached stats queries. Drops the database at the end.
// `pnpm perf:stats --activity [--rows=N]` (task 6.5) also adds a PU lead per PU and N (1M) real supporter rows (captured over 90 days;
// every 10th lead not in the last 10 days) and times the leaderboard and inactive-leads queries. Takes a few minutes.
import { randomBytes } from 'node:crypto'
import { config } from 'dotenv'
import postgres from 'postgres'
import { createDb } from '../server/db/client.ts'
import { runMigrations } from '../server/db/migrate.ts'
import { inactiveLeads, leaderboard } from '../server/services/activity.ts'
import { childrenStats, unitStats } from '../server/services/stats.ts'

config({ quiet: true })

const ADMIN_URL = process.env.NUXT_DATABASE_URL ?? 'postgres://tattara:tattara@localhost:5432/tattara'
const STATES = ['17', '18', '19', '20', '21', '34', '35']
const LGAS_PER_STATE = [26, 27, 27, 26, 27, 26, 27] // 186
const WARDS = 2003
const PUS = 41_671
const SUPPORTERS = 5_000_000
const RUNS = 100
const ACTIVITY = process.argv.includes('--activity')
/** Supporter rows for --activity: 1M by default (5M needs ~6 GB of Docker disk); `--rows=5000000` for the full size. */
const ACTIVITY_ROWS = Number(process.argv.find(a => a.startsWith('--rows='))?.slice(7) ?? 1_000_000)
const ACTIVITY_RUNS = 20
const P95_LIMIT_MS = 300

let seed = 20261008
const rand = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
  return seed / 2 ** 31
}
const pad = (n: number, w: number) => String(n).padStart(w, '0')

function geography() {
  const lgas: string[] = []
  STATES.forEach((s, i) => {
    for (let l = 1; l <= LGAS_PER_STATE[i]!; l++) lgas.push(`${s}/${pad(l, 2)}`)
  })
  const wardCount = new Map<string, number>()
  const wards: string[] = []
  for (let w = 0; w < WARDS; w++) {
    const lga = lgas[w % lgas.length]!
    const n = (wardCount.get(lga) ?? 0) + 1
    wardCount.set(lga, n)
    wards.push(`${lga}/${pad(n, 2)}`)
  }
  const puCount = new Map<string, number>()
  const pus: string[] = []
  for (let p = 0; p < PUS; p++) {
    const ward = wards[p % wards.length]!
    const n = (puCount.get(ward) ?? 0) + 1
    puCount.set(ward, n)
    pus.push(`${ward}/${pad(n, 3)}`)
  }
  return { lgas, wards, pus }
}

const p = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!

async function time(label: string, fn: () => Promise<unknown>, runs = RUNS) {
  await fn() // warm-up
  const ms: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    await fn()
    ms.push(performance.now() - t)
  }
  ms.sort((a, b) => a - b)
  console.log(`${label.padEnd(28)} p50 ${p(ms, 0.5).toFixed(1)} ms   p95 ${p(ms, 0.95).toFixed(1)} ms   max ${ms.at(-1)!.toFixed(1)} ms`)
  return p(ms, 0.95)
}

const name = `tattara_perf_${randomBytes(4).toString('hex')}`
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} })
await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`)
const url = new URL(ADMIN_URL)
url.pathname = `/${name}`
let p95: number | undefined
try {
  await runMigrations(url.toString())
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const { lgas, wards, pus } = geography()
  console.log(`Seeding ${STATES.length} states, ${lgas.length} LGAs, ${wards.length} wards, ${pus.length} PUs…`)

  type UnitRow = { code: string, level: string, parent_code: string | null, name: string, name_normalised: string, registered_voters: number | null, source_version: string }
  const unit = (code: string, level: string, parent: string | null, voters: number | null = null): UnitRow =>
    ({ code, level, parent_code: parent, name: `Unit ${code}`, name_normalised: `unit ${code}`, registered_voters: voters, source_version: 'perf' })
  const insertUnits = async (rows: UnitRow[]) => {
    for (let i = 0; i < rows.length; i += 2000) await sql`insert into units ${sql(rows.slice(i, i + 2000))}`
  }
  await insertUnits(STATES.map(s => unit(s, 'state', null)))
  await insertUnits(lgas.map(c => unit(c, 'lga', c.slice(0, 2))))
  await insertUnits(wards.map(c => unit(c, 'ward', c.slice(0, 5))))
  await insertUnits(pus.map(c => unit(c, 'pu', c.slice(0, 8), rand() < 0.8 ? 300 + Math.floor(rand() * 900) : null)))

  // pu_stats: totals summing to exactly 5M, with plausible breakdowns.
  const weights = pus.map(() => 0.2 + rand())
  const scale = SUPPORTERS / weights.reduce((a, b) => a + b, 0)
  const totals = weights.map(w => Math.floor(w * scale))
  totals[0]! += SUPPORTERS - totals.reduce((a, b) => a + b, 0)
  const stats = pus.map((code, i) => {
    const t = totals[i]!
    const strong = Math.floor(t * 0.6)
    const leaning = Math.floor(t * 0.28)
    return {
      pu_code: code, total: t, verified: Math.floor(t * 0.6), flagged_open: Math.floor(t * 0.01), male: Math.floor(t * 0.55),
      female: t - Math.floor(t * 0.55), age_25_34: t, strong, leaning, undecided: t - strong - leaning,
      has_pvc_yes: Math.floor(t * 0.75), volunteers: Math.floor(t * 0.1), opted_out: Math.floor(t * 0.03),
    }
  })
  for (let i = 0; i < stats.length; i += 2000) await sql`insert into pu_stats ${sql(stats.slice(i, i + 2000))}`
  await sql`insert into unit_targets (unit_code, target) select code, 1000 from units where level in ('state', 'lga', 'ward')`
  if (ACTIVITY) {
    console.log(`Adding ${PUS} PU leads and ${ACTIVITY_ROWS} supporter rows…`)
    // Throwaway database: the search and GPS indexes don't serve these queries and only slow the bulk insert.
    await sql`drop index if exists supporters_full_name_trgm_idx, supporters_phone_trgm_idx, supporters_gps_gist_idx`
    await sql`
      insert into users (id, full_name, phone, role, unit_code, unit_level, pin_hash, status, created_at)
      select gen_random_uuid(), 'Lead ' || code, '+23480' || lpad(row_number() over (order by code)::text, 8, '0'), 'PU_LEAD', code, 'pu', 'x', 'active',
        now() - interval '120 days'
      from units where level = 'pu'`
    await sql`
      with pl as (select row_number() over (order by u.unit_code) - 1 as rn, u.unit_code as code, u.id from users u where u.role = 'PU_LEAD')
      insert into supporters (id, pu_code, full_name, phone, support_level, has_pvc, consent_at, consent_version, consent_language,
        captured_at, captured_by, device_id)
      select overlay(gen_random_uuid()::text placing '7' from 15 for 1)::uuid, pl.code, 'Perf Supporter', '+234803' || lpad(g::text, 7, '0'), 'strong', 'yes', t.at, 'c1-ha', 'ha',
        t.at, pl.id, 'perf'
      from generate_series(0, ${ACTIVITY_ROWS - 1}) g
      join pl on pl.rn = g % ${PUS}
      cross join lateral (select now() - (case when pl.rn % 10 = 0 then interval '10 days' else interval '0' end)
        - random() * interval '80 days' as at) t`
  }
  await sql`analyze`
  await sql.end()

  const { db, client } = createDb(url.toString(), { max: 2 })
  console.log(`Timing ${RUNS} uncached runs each:`)
  p95 = await time('/stats/children/all', () => childrenStats(db, ''))
  await time('/stats/children/19 (state)', () => childrenStats(db, '19'))
  await time('/stats/unit/all', () => unitStats(db, ''))
  await time('/stats/unit/19/01 (LGA)', () => unitStats(db, '19/01'))
  if (ACTIVITY) {
    await time('/stats/leaderboard/all (PU)', () => leaderboard(db, '', 'pu', 'recent', 20), ACTIVITY_RUNS)
    await time('/stats/leaderboard/19 (LGA)', () => leaderboard(db, '19', undefined, 'recent', 20), ACTIVITY_RUNS)
    await time('/stats/leaderboard/19/01/01', () => leaderboard(db, '19/01/01', undefined, 'recent', 20), ACTIVITY_RUNS)
    await time('/stats/inactive/all', () => inactiveLeads(db, '', 3), ACTIVITY_RUNS)
    await time('/stats/inactive/19 (state)', () => inactiveLeads(db, '19', 3), ACTIVITY_RUNS)
    await time('/stats/inactive/19/01/01', () => inactiveLeads(db, '19/01/01', 3), ACTIVITY_RUNS)
  }
  await client.end()
  console.log(p95 >= P95_LIMIT_MS ? `FAIL: /stats/children/all p95 ≥ ${P95_LIMIT_MS} ms` : `OK: /stats/children/all p95 < ${P95_LIMIT_MS} ms`)
}
finally {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.end()
}
process.exit(p95 !== undefined && p95 < P95_LIMIT_MS ? 0 : 1)
