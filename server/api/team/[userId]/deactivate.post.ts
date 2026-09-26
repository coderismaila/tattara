// POST /api/team/:userId/deactivate { reason } — direct children only; audited; bumps session_version (API.md).
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { AuditPiiError } from '~~/server/services/audit'
import { deactivateLead } from '~~/server/services/team'
import { deactivateSchema } from '~~/shared/schemas/team'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { readValidated } from '~~/server/utils/validate'
import { teamTargetError, userIdParam } from '~~/server/utils/team-http'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const userId = userIdParam(getRouterParam(event, 'userId'))
  const { reason } = await readValidated(event, deactivateSchema)

  try {
    const result = await deactivateLead(useDb(), user, userId, reason)
    if (result.kind !== 'ok') throw teamTargetError(result.kind)
    return { ok: true }
  }
  catch (error) {
    if (error instanceof AuditPiiError) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid', issues: [{ path: 'reason', message: 'team.errors.reasonPii' }] } })
    }
    throw error
  }
})
