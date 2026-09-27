// POST /api/supporters/:id/removal { reason } → status removal_requested (API.md, US-8). PU/ward lead in scope; audited.
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requestRemoval, serializeSupporter } from '~~/server/services/supporters'
import { AuditPiiError } from '~~/server/services/audit'
import { removalRequestSchema } from '~~/shared/schemas/supporter'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { supporterIdParam, supporterNotFound } from '~~/server/utils/supporter-http'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const id = supporterIdParam(getRouterParam(event, 'id'))
  const { reason } = await readValidated(event, removalRequestSchema)
  try {
    const result = await requestRemoval(useDb(), user, id, reason)
    if (result.kind === 'not_found') throw supporterNotFound()
    if (result.kind === 'already_requested') throw createError({ statusCode: 409, statusMessage: 'Conflict', data: { reason: 'already_requested' } })
    return { supporter: serializeSupporter(result.supporter, user.role) }
  }
  catch (error) {
    if (error instanceof AuditPiiError) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid', issues: [{ path: 'reason', message: 'supporter.errors.reasonPii' }] } })
    }
    throw error
  }
})
