// Fresh E2E database for every run: migrations, dev seed (users with PIN 123456), and one invited PU lead.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import postgres from 'postgres'
import { createDb } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { users } from '../../server/db/schema'
import { createInvite } from '../../server/services/auth'
import { seedDev } from '../../scripts/seed/run'
import { eq } from 'drizzle-orm'
import { ADMIN_DB_URL, E2E_DB_URL, FIXTURE_FILE, OUTBOX_FILE, type E2EFixture } from './support/env'

export default async function globalSetup() {
  const admin = postgres(ADMIN_DB_URL, { max: 1, onnotice: () => {} })
  await admin.unsafe('drop database if exists tattara_e2e with (force)')
  await admin.unsafe('create database tattara_e2e template template0')
  await admin.end()

  await runMigrations(E2E_DB_URL)
  await seedDev(E2E_DB_URL, { nodeEnv: 'test' })

  const { db, client } = createDb(E2E_DB_URL, { max: 1 })
  try {
    const [ward] = await db.select({ id: users.id }).from(users).where(eq(users.phone, '+2348000000103'))
    const invitedPhone = '+2348031000001'
    const [lead] = await db.insert(users).values({
      fullName: 'E2E Invited PU Lead',
      phone: invitedPhone,
      role: 'PU_LEAD',
      unitCode: '19/01/01/002',
      unitLevel: 'pu',
      status: 'invited',
      invitedBy: ward!.id,
    }).returning({ id: users.id })
    const inviteToken = await createInvite(db, lead!.id, ward!.id)

    mkdirSync(dirname(FIXTURE_FILE), { recursive: true })
    rmSync(OUTBOX_FILE, { force: true })
    writeFileSync(FIXTURE_FILE, JSON.stringify({ invitedPhone, inviteToken } satisfies E2EFixture))
  }
  finally {
    await client.end()
  }
}
