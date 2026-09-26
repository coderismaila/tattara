// GET /api/auth/me → { user, unit, scope } (API.md). IDs, role and unit only: no phone.
import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { units, users } from '~~/server/db/schema'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { scopeForUser } from '~~/server/utils/scope'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const db = useDb()
  const [profile] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, user.id))
  const [unit] = user.unitCode
    ? await db.select({ code: units.code, name: units.name, level: units.level }).from(units).where(eq(units.code, user.unitCode))
    : []
  const scope = scopeForUser(user)
  return {
    user: { id: user.id, fullName: profile?.fullName ?? '', role: user.role, unitCode: user.unitCode },
    unit: unit ?? null,
    scope: { unitCode: scope.unitCode, prefix: scope.prefix },
  }
})
