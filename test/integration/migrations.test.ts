import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../../server/db/client'
import { migrationsFolder, runMigrations } from '../../server/db/migrate'
import { createTempDatabase, isDbReachable } from './helpers/db'

// Needs Postgres+PostGIS (`pnpm db:up`). Skipped when no DB is reachable; CI provides one.
const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] }

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

describe.skipIf(!dbAvailable)('database migrations', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>

  beforeAll(async () => {
    temp = await createTempDatabase()
  })

  afterAll(async () => {
    await temp?.drop()
  })

  it('starts without PostGIS in a fresh database', async () => {
    const { db, client } = createDb(temp.url, { max: 1 })
    const rows = await db.execute(sql`select 1 from pg_extension where extname = 'postgis'`)
    await client.end()
    expect(rows).toHaveLength(0)
  })

  it('applies every migration, enables PostGIS and is idempotent', async () => {
    await runMigrations(temp.url)
    await runMigrations(temp.url)

    const { db, client } = createDb(temp.url, { max: 1 })
    try {
      const [version] = await db.execute<{ v: string }>(sql`select postgis_version() as v`)
      expect(version?.v).toMatch(/^3\./)

      const [applied] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      )
      expect(applied?.n).toBe(journal.entries.length)
    }
    finally {
      await client.end()
    }
  })
})
