// Writes the dev seed. Extended by later tasks: users for every role (2.1), supporters (3.1).
import { and, count, eq, inArray, ne, sql } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client.ts'
import { unitTargets, units } from '../../server/db/schema/index.ts'
import { UNIT_LEVELS } from '../../shared/constants/enums.ts'
import { DEV_SOURCE_VERSION, generateDevGeography } from './dev-geography.ts'

export class SeedRefusedError extends Error {
  override name = 'SeedRefusedError'
}

export interface SeedOptions {
  /** Delete existing dev-fake rows before seeding. */
  reset?: boolean
  /** Defaults to process.env.NODE_ENV; the seed never runs in production. */
  nodeEnv?: string
}

export interface SeedResult {
  units: number
  targets: number
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

async function deleteDevGeography(tx: Tx) {
  const devCodes = tx.select({ code: units.code }).from(units).where(eq(units.sourceVersion, DEV_SOURCE_VERSION))
  await tx.delete(unitTargets).where(inArray(unitTargets.unitCode, devCodes))
  // Children first (FK to parent).
  for (const level of [...UNIT_LEVELS].reverse()) {
    await tx.delete(units).where(and(eq(units.sourceVersion, DEV_SOURCE_VERSION), eq(units.level, level)))
  }
}

export async function seedDev(url: string, options: SeedOptions = {}): Promise<SeedResult> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV
  if (nodeEnv === 'production') {
    throw new SeedRefusedError('Refusing to run the dev seed with NODE_ENV=production.')
  }

  const { db, client } = createDb(url, { max: 1 })
  try {
    const [real] = await db.select({ n: count() }).from(units).where(ne(units.sourceVersion, DEV_SOURCE_VERSION))
    if (real && real.n > 0) {
      throw new SeedRefusedError(
        `Refusing to seed fake geography: ${real.n} real (non-${DEV_SOURCE_VERSION}) units exist in this database.`,
      )
    }

    const { units: devUnits, targets } = generateDevGeography()

    await db.transaction(async (tx) => {
      if (options.reset) await deleteDevGeography(tx)

      // Parents before children (FK), upsert by code so re-runs are safe.
      for (const level of UNIT_LEVELS) {
        const rows = devUnits.filter(u => u.level === level)
        await tx.insert(units).values(rows).onConflictDoUpdate({
          target: units.code,
          set: {
            name: sql`excluded.name`,
            nameNormalised: sql`excluded.name_normalised`,
            registeredVoters: sql`excluded.registered_voters`,
            location: sql`excluded.location`,
            updatedAt: sql`now()`,
          },
        })
      }

      await tx.insert(unitTargets).values(targets).onConflictDoUpdate({
        target: unitTargets.unitCode,
        set: { target: sql`excluded.target`, setAt: sql`now()` },
      })
    })

    return { units: devUnits.length, targets: targets.length }
  }
  finally {
    await client.end()
  }
}
