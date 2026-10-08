// Writes the dev seed: fake geography + targets (1.2), a user per role (2.1), ~5,000 fake supporters (3.1).
// If real INEC geography has been imported (pnpm db:seed), only the dev users are seeded, on real unit codes.
import { and, count, eq, inArray, like, ne, or, sql } from 'drizzle-orm'
import { createDb, type Db } from '../../server/db/client.ts'
import { flags, invites, otpCodes, puStats, supporters, unitTargets, units, userDevices, users } from '../../server/db/schema/index.ts'
import { runFlagChecks } from '../../server/services/flags.ts'
import { recomputePuStats } from '../../server/services/supporters.ts'
import { hashPin } from '../../server/utils/pin.ts'
import { UNIT_LEVELS } from '../../shared/constants/enums.ts'
import { ROLE_LEVEL } from '../../shared/constants/roles.ts'
import { DEV_SOURCE_VERSION, generateDevGeography } from './dev-geography.ts'
import { generateDevSupporters } from './dev-supporters.ts'
import { DEV_PHONE_PREFIX, DEV_PIN, DEV_USERS } from './dev-users.ts'

export class SeedRefusedError extends Error {
  override name = 'SeedRefusedError'
}

export interface SeedOptions {
  /** Delete existing dev rows before seeding. */
  reset?: boolean
  /** Defaults to process.env.NODE_ENV; the seed never runs in production. */
  nodeEnv?: string
}

export interface SeedResult {
  units: number
  targets: number
  users: number
  supporters: number
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const FK_VIOLATION = '23503'

async function deleteDevData(tx: Tx) {
  // Supporters (and their flags/counters) on dev units or captured by dev users go first (FKs).
  const devCodes = tx.select({ code: units.code }).from(units).where(eq(units.sourceVersion, DEV_SOURCE_VERSION))
  const devUserIdsForSupporters = tx.select({ id: users.id }).from(users).where(like(users.phone, `${DEV_PHONE_PREFIX}%`))
  await tx.delete(flags).where(inArray(flags.puCode, devCodes))
  await tx.delete(supporters).where(or(inArray(supporters.puCode, devCodes), inArray(supporters.capturedBy, devUserIdsForSupporters)))
  await tx.delete(puStats).where(inArray(puStats.puCode, devCodes))

  const devUserIds = tx.select({ id: users.id }).from(users).where(like(users.phone, `${DEV_PHONE_PREFIX}%`))
  await tx.delete(userDevices).where(inArray(userDevices.userId, devUserIds))
  await tx.delete(invites).where(inArray(invites.userId, devUserIds))
  await tx.delete(otpCodes).where(like(otpCodes.phone, `${DEV_PHONE_PREFIX}%`))
  await tx.update(unitTargets).set({ setBy: null }).where(inArray(unitTargets.setBy, devUserIds))
  // A dev user may have reported a PU's registered voters (3.7): keep the figure, forget the reporter.
  await tx.update(units).set({ registeredVotersReportedBy: null, registeredVotersReportedAt: null })
    .where(inArray(units.registeredVotersReportedBy, devUserIds))
  // Break the invited_by chain, then delete.
  await tx.update(users).set({ invitedBy: null }).where(like(users.phone, `${DEV_PHONE_PREFIX}%`))
  await tx.delete(users).where(like(users.phone, `${DEV_PHONE_PREFIX}%`))

  await tx.delete(unitTargets).where(inArray(unitTargets.unitCode, devCodes))
  // Children first (FK to parent).
  for (const level of [...UNIT_LEVELS].reverse()) {
    await tx.delete(units).where(and(eq(units.sourceVersion, DEV_SOURCE_VERSION), eq(units.level, level)))
  }
}

async function seedGeography(tx: Tx) {
  const { units: devUnits, targets } = generateDevGeography()

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

  return { units: devUnits.length, targets: targets.length }
}

async function seedUsers(tx: Tx) {
  const pinHash = await hashPin(DEV_PIN)
  const idByKey = new Map<string, string>()

  for (const spec of DEV_USERS) {
    const values = {
      fullName: spec.fullName,
      phone: spec.phone,
      role: spec.role,
      unitCode: spec.unitCode,
      unitLevel: ROLE_LEVEL[spec.role],
      pinHash,
      status: 'active' as const,
      failedPinAttempts: 0,
      lockedUntil: null,
      invitedBy: spec.invitedBy ? idByKey.get(spec.invitedBy)! : null,
    }
    const [row] = await tx.insert(users).values(values).onConflictDoUpdate({
      target: users.phone,
      set: { ...values, updatedAt: sql`now()` },
    }).returning({ id: users.id })
    idByKey.set(spec.key, row!.id)
  }

  return idByKey
}

/** Fake supporters on the dev PUs, credited to each state's dev PU lead; then pu_stats from scratch. */
async function seedSupporters(tx: Tx, idByKey: Map<string, string>) {
  const pus = generateDevGeography().units.filter(u => u.level === 'pu')
  const { supporters: rows } = generateDevSupporters(pus, { 19: idByKey.get('Kano-PU_LEAD')!, 20: idByKey.get('Katsina-PU_LEAD')! })
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(supporters).values(rows.slice(i, i + 500)).onConflictDoNothing({ target: supporters.id })
  }
  for (const state of ['19', '20']) await recomputePuStats(tx, state)
  return rows.length
}

export async function seedDev(url: string, options: SeedOptions = {}): Promise<SeedResult> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV
  if (nodeEnv === 'production') {
    throw new SeedRefusedError('Refusing to run the dev seed with NODE_ENV=production.')
  }

  const { db, client } = createDb(url, { max: 1 })
  try {
    // With real (imported) geography, never add fake units: seed only the dev users, on real unit codes.
    const [real] = await db.select({ n: count() }).from(units).where(ne(units.sourceVersion, DEV_SOURCE_VERSION))
    const realGeography = !!real && real.n > 0
    if (realGeography) {
      const needed = DEV_USERS.map(u => u.unitCode).filter((c): c is string => c !== null)
      const found = await db.select({ code: units.code }).from(units).where(inArray(units.code, needed))
      const missing = needed.filter(c => !found.some(f => f.code === c))
      if (missing.length) {
        throw new SeedRefusedError(`Real geography is loaded but lacks the dev users' units: ${missing.join(', ')}.`)
      }
    }

    const result = await db.transaction(async (tx) => {
      if (options.reset) {
        try {
          await tx.transaction(deleteDevData)
        }
        catch (error) {
          const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code
          if (code === FK_VIOLATION) {
            throw new SeedRefusedError(
              'Cannot --reset: dev users are referenced by audit_log (append-only). '
              + 'Recreate the local DB instead: docker compose down -v && pnpm db:up && pnpm db:migrate && pnpm db:seed:dev',
            )
          }
          throw error
        }
      }
      const geo = realGeography ? { units: 0, targets: 0 } : await seedGeography(tx)
      const idByKey = await seedUsers(tx)
      const supporterCount = realGeography ? 0 : await seedSupporters(tx, idByKey)
      return { ...geo, users: idByKey.size, supporters: supporterCount }
    })
    // The planted patterns become open flags (5.1), as the nightly scan would raise them.
    if (result.supporters > 0) await runFlagChecks(db)
    return result
  }
  finally {
    await client.end()
  }
}
