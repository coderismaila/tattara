import { useRuntimeConfig } from 'nitropack/runtime'
import { createDb, type Db } from '~~/server/db/client'

let db: Db | undefined

/** Shared Drizzle instance for server routes and services (one pool per server process). */
export function useDb(): Db {
  db ??= createDb(useRuntimeConfig().databaseUrl).db
  return db
}
