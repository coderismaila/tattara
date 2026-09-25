// Usage: pnpm db:seed:dev [--reset]
// Seeds FAKE dev data (SEED_DATA §5). Never runs in production or on a DB with real INEC units.
import { config } from 'dotenv'
import { SeedRefusedError, seedDev } from './seed/run.ts'

config({ quiet: true })

const url = process.env.NUXT_DATABASE_URL
if (!url) {
  console.error('NUXT_DATABASE_URL is not set. Copy .env.example to .env or export it.')
  process.exit(1)
}

try {
  const result = await seedDev(url, { reset: process.argv.includes('--reset') })
  console.log(`Dev seed applied: ${result.units} units, ${result.targets} targets.`)
}
catch (error) {
  if (error instanceof SeedRefusedError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}
