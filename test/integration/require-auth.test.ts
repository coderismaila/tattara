import { eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { userDevices, users } from '../../server/db/schema'
import { seedDev } from '../../scripts/seed/run'
import type { SecureSession, SessionUser } from '../../shared/types/auth'
import { createTempDatabase, isDbReachable } from './helpers/db'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

// In-memory session store and the test DB behind the Nitro seams.
const state = vi.hoisted(() => ({
  session: {} as { user?: SessionUser, secure?: Partial<SecureSession> },
  cleared: 0,
  db: undefined as unknown,
}))
vi.mock('../../server/auth/session', () => ({
  getUserSession: async () => ({ id: 's', ...state.session }),
  setUserSession: async (_e: unknown, data: typeof state.session) => {
    state.session = { ...state.session, ...data }
  },
  replaceUserSession: async (_e: unknown, data: typeof state.session) => {
    state.session = data
  },
  clearUserSession: async () => {
    state.session = {}
    state.cleared++
  },
}))
vi.mock('../../server/utils/db', () => ({ useDb: () => state.db }))

const { requireAuth, startSession, SESSION_IDLE_MS, SESSION_REFRESH_MS } = await import('../../server/utils/auth')
const { getScope } = await import('../../server/utils/scope')

const PU_LEAD = '+2348000000104'
const newEvent = () => ({ context: {} }) as unknown as H3Event
const statusOf = (p: Promise<unknown>) => p.then(() => 200, (e: { statusCode?: number }) => e.statusCode)

describe.skipIf(!dbAvailable)('requireAuth', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  let lead: typeof users.$inferSelect
  const DEVICE = '0190f3a2-1c4b-7d8e-9f0a-1b2c3d4e5f60'

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    await seedDev(temp.url, { nodeEnv: 'test' })
    const conn = createDb(temp.url, { max: 2 })
    db = conn.db
    state.db = db
    close = () => conn.client.end()
    lead = (await db.select().from(users).where(eq(users.phone, PU_LEAD)))[0]!
    await db.insert(userDevices).values({ userId: lead.id, deviceId: DEVICE })
  })

  beforeEach(async () => {
    state.cleared = 0
    await db.update(users).set({ status: 'active', sessionVersion: lead.sessionVersion, role: 'PU_LEAD' }).where(eq(users.id, lead.id))
    await db.update(userDevices).set({ revokedAt: null })
    await startSession(newEvent(), { id: lead.id, role: lead.role, unitCode: lead.unitCode, sessionVersion: lead.sessionVersion }, DEVICE)
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('accepts a valid session and caches it on the request', async () => {
    const event = newEvent()
    const ctx = await requireAuth(event)
    expect(ctx).toEqual({ user: { id: lead.id, role: 'PU_LEAD', unitCode: '19/01/01/001', sessionVersion: lead.sessionVersion }, deviceId: DEVICE })
    expect(await requireAuth(event)).toBe(ctx)
    expect(await getScope(event)).toMatchObject({ unitCode: '19/01/01/001' })
  })

  it('401 without a session', async () => {
    state.session = {}
    expect(await statusOf(requireAuth(newEvent()))).toBe(401)
  })

  it.each([
    ['the user was deactivated', async () => db.update(users).set({ status: 'deactivated' }).where(eq(users.id, lead.id))],
    ['the session version was bumped (PIN reset)', async () => db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, lead.id))],
    ['the device was revoked (wipe)', async () => db.update(userDevices).set({ revokedAt: sql`now()` })],
    ['30 days passed without activity', async () => {
      state.session.secure!.refreshedAt = Date.now() - SESSION_IDLE_MS - 1000
    }],
  ])('401 and clears the session when %s', async (_label, change) => {
    await change()
    expect(await statusOf(requireAuth(newEvent()))).toBe(401)
    expect(state.cleared).toBe(1)
    expect(state.session).toEqual({})
  })

  it('takes role and unit from the DB, not the cookie', async () => {
    state.session.user = { ...state.session.user!, role: 'DG', unitCode: null }
    expect((await requireAuth(newEvent())).user).toMatchObject({ role: 'PU_LEAD', unitCode: '19/01/01/001' })
  })

  it('slides the session and last_seen_at at most hourly', async () => {
    const stale = Date.now() - SESSION_REFRESH_MS - 1000
    state.session.secure!.refreshedAt = stale
    await db.update(users).set({ lastSeenAt: null }).where(eq(users.id, lead.id))
    await requireAuth(newEvent())
    expect(state.session.secure!.refreshedAt).toBeGreaterThan(stale)
    expect((await db.select().from(users).where(eq(users.id, lead.id)))[0]!.lastSeenAt).toBeInstanceOf(Date)

    const fresh = state.session.secure!.refreshedAt!
    await requireAuth(newEvent())
    expect(state.session.secure!.refreshedAt).toBe(fresh)
  })
})
