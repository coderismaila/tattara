// Write normalised units to the DB: upsert by code, never delete, deactivate units missing from the import
// (SEED_DATA §6). With dryRun, computes the same diff and writes nothing.
import { and, count, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Db } from '../../server/db/client.ts'
import { units } from '../../server/db/schema/index.ts'
import { UNIT_LEVELS } from '../../shared/constants/enums.ts'
import { DEV_SOURCE_VERSION } from '../seed/dev-geography.ts'
import type { NormalisedUnit } from './inec.ts'

export class ImportRefusedError extends Error {
  override name = 'ImportRefusedError'
}

export interface ImportDiff {
  added: number
  updated: number
  unchanged: number
  deactivated: number
  reactivated: number
}

const BATCH = 1000

const sameLocation = (a: { lng: number, lat: number } | null, b: { lng: number, lat: number } | null) =>
  a === b || (!!a && !!b && Math.abs(a.lng - b.lng) < 1e-6 && Math.abs(a.lat - b.lat) < 1e-6)

export async function writeUnits(db: Db, rows: NormalisedUnit[], options: { dryRun?: boolean } = {}): Promise<ImportDiff> {
  const [dev] = await db.select({ n: count() }).from(units).where(eq(units.sourceVersion, DEV_SOURCE_VERSION))
  if (dev && dev.n > 0) {
    throw new ImportRefusedError(
      `This database holds ${dev.n} fake dev units (${DEV_SOURCE_VERSION}). Import real geography into a fresh DB: `
      + 'docker compose down -v && pnpm db:up && pnpm db:migrate && pnpm db:seed (then pnpm db:seed:dev adds dev users).',
    )
  }

  const existing = await db.select({
    code: units.code,
    name: units.name,
    registeredVoters: units.registeredVoters,
    location: units.location,
    locationEstimated: units.locationEstimated,
    boundaryRef: units.boundaryRef,
    active: units.active,
  }).from(units)
  const before = new Map(existing.map(e => [e.code, e]))
  const incoming = new Set(rows.map(r => r.code))

  const diff: ImportDiff = { added: 0, updated: 0, unchanged: 0, deactivated: 0, reactivated: 0 }
  for (const r of rows) {
    const e = before.get(r.code)
    if (!e) {
      diff.added++
      continue
    }
    if (!e.active) diff.reactivated++
    const changed = e.name !== r.name
      || e.registeredVoters !== r.registeredVoters
      || e.locationEstimated !== r.locationEstimated
      || e.boundaryRef !== r.boundaryRef
      || !sameLocation(e.location, r.location)
    if (changed) diff.updated++
    else if (e.active) diff.unchanged++
  }
  diff.deactivated = existing.filter(e => e.active && !incoming.has(e.code)).length

  if (options.dryRun) return diff

  await db.transaction(async (tx) => {
    // Parents before children (FK); upsert so re-imports and refreshes are idempotent.
    for (const level of UNIT_LEVELS) {
      const levelRows = rows.filter(r => r.level === level)
      for (let i = 0; i < levelRows.length; i += BATCH) {
        await tx.insert(units).values(levelRows.slice(i, i + BATCH)).onConflictDoUpdate({
          target: units.code,
          set: {
            name: sql`excluded.name`,
            nameNormalised: sql`excluded.name_normalised`,
            registeredVoters: sql`excluded.registered_voters`,
            location: sql`excluded.location`,
            locationEstimated: sql`excluded.location_estimated`,
            boundaryRef: sql`excluded.boundary_ref`,
            sourceVersion: sql`excluded.source_version`,
            active: sql`true`,
            updatedAt: sql`now()`,
          },
        })
      }
    }
    // Never delete (supporters keep their pu_code): deactivate what INEC no longer lists.
    const stale = existing.filter(e => e.active && !incoming.has(e.code)).map(e => e.code)
    for (let i = 0; i < stale.length; i += BATCH) {
      await tx.update(units).set({ active: false, updatedAt: sql`now()` })
        .where(and(inArray(units.code, stale.slice(i, i + BATCH)), ne(units.sourceVersion, DEV_SOURCE_VERSION)))
    }
  })

  return diff
}
