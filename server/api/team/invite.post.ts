// POST /api/team/invite { unitCode, fullName, phone, replace? } — unitCode must be a DIRECT child of my unit (API.md).
import { createError, defineEventHandler } from 'h3'
import { inviteLead } from '~~/server/services/team'
import { inviteSchema } from '~~/shared/schemas/team'
import { requireAuth } from '~~/server/utils/auth'
import { sendQueuedSmsNow, useAuthConfig } from '~~/server/utils/auth-config'
import { useDb } from '~~/server/utils/db'
import { RATE_LIMITS, enforceRateLimit } from '~~/server/utils/rate-limit'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const input = await readValidated(event, inviteSchema)
  // Each invite costs an SMS: cap what one (possibly compromised) account can send.
  await enforceRateLimit(event, `invite:${user.id}`, RATE_LIMITS.invite)

  const result = await inviteLead(useDb(), user, input, useAuthConfig(), sendQueuedSmsNow)
  switch (result.kind) {
    case 'ok':
      return { userId: result.userId, replacedUserId: result.replacedUserId }
    case 'forbidden':
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_your_unit' } })
    case 'unit_has_active_lead':
    case 'already_active':
    case 'phone_in_use':
      throw createError({ statusCode: 409, statusMessage: 'Conflict', data: { reason: result.kind } })
  }
})
