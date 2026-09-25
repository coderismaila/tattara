// Runtime-agnostic Drizzle client factory: used by Nitro (via server/utils/db.ts),
// scripts and tests. Must not import Nitro/Nuxt runtime code.
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.ts'

export interface CreateDbOptions {
  /** Max pool connections. */
  max?: number
}

export function createDb(url: string, options: CreateDbOptions = {}) {
  if (!url) {
    throw new Error('Database URL is empty. Set NUXT_DATABASE_URL (see .env.example).')
  }
  const client = postgres(url, {
    max: options.max ?? 10,
    // Keep timestamps in UTC; display conversion to Africa/Lagos happens in the UI.
    connection: { TimeZone: 'UTC' },
    onnotice: () => {},
  })
  const db = drizzle({ client, schema, casing: 'snake_case' })
  return { db, client }
}

export type Db = ReturnType<typeof createDb>['db']
