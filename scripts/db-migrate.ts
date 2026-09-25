// Usage: pnpm db:migrate   (reads NUXT_DATABASE_URL from the environment or .env)
import { config } from 'dotenv'
import { runMigrations } from '../server/db/migrate.ts'

config({ quiet: true })

const url = process.env.NUXT_DATABASE_URL
if (!url) {
  console.error('NUXT_DATABASE_URL is not set. Copy .env.example to .env or export it.')
  process.exit(1)
}

await runMigrations(url)
console.log('Migrations applied.')
