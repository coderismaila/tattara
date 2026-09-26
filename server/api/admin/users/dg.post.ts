// POST /api/admin/users/dg { fullName, phone, replace? }: invite the DG by SMS. ADMIN only; never returns the token.
import { createError, defineEventHandler } from 'h3'
import { inviteDg } from '~~/server/services/admin'
import { dgInviteSchema } from '~~/shared/schemas/admin'
import { requireAdmin } from '~~/server/utils/admin'
import { sendQueuedSmsNow, useAuthConfig } from '~~/server/utils/auth-config'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, enforceRateLimit } from '~~/server/utils/rate-limit'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAdmin(event)
  const input = await readValidated(event, dgInviteSchema)
  await enforceRateLimit(event, `invite:${user.id}`, RATE_LIMITS.invite)

  const result = await inviteDg(useDb(), { id: user.id, role: 'ADMIN' }, input, useAuthConfig(), sendQueuedSmsNow)
  if (result.kind !== 'ok') throw createError({ statusCode: 409, statusMessage: 'Conflict', data: { reason: result.kind } })
  return { userId: result.userId, replacedUserId: result.replacedUserId }
})
