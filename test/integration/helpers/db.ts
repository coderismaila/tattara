import { randomBytes } from 'node:crypto'
import postgres from 'postgres'

/** Admin connection for tests: NUXT_DATABASE_URL, or the local docker-compose DB. */
export const adminUrl = process.env.NUXT_DATABASE_URL
  ?? 'postgres://tattara:tattara@localhost:5432/tattara'

export async function isDbReachable(): Promise<boolean> {
  const sql = postgres(adminUrl, { max: 1, connect_timeout: 2, onnotice: () => {} })
  try {
    await sql`select 1`
    return true
  }
  catch {
    return false
  }
  finally {
    await sql.end({ timeout: 1 })
  }
}

/**
 * Creates an empty database from template0 (no extensions pre-installed, unlike the
 * postgis image's default DB) and returns its URL plus a drop function.
 */
export async function createTempDatabase(): Promise<{ url: string, drop: () => Promise<void> }> {
  const name = `tattara_it_${randomBytes(6).toString('hex')}`
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`)

  const url = new URL(adminUrl)
  url.pathname = `/${name}`

  return {
    url: url.toString(),
    drop: async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    },
  }
}
