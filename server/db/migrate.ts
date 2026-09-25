import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './client.ts'

export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))

/** Apply all pending migrations. Idempotent. Uses drizzle-orm's migrator so deploys don't need drizzle-kit. */
export async function runMigrations(url: string): Promise<void> {
  const { db, client } = createDb(url, { max: 1 })
  try {
    await migrate(db, { migrationsFolder })
  }
  finally {
    await client.end()
  }
}
