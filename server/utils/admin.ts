// ADMIN-only routes: 403 for every other role (the admin has no unit, so requireScope doesn't apply).
import { createError, type H3Event } from 'h3'
import { requireAuth, type AuthContext } from './auth.ts'

export async function requireAdmin(event: H3Event): Promise<AuthContext> {
  const auth = await requireAuth(event)
  if (auth.user.role !== 'ADMIN') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'admin_only' } })
  return auth
}
