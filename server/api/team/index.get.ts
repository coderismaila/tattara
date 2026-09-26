// GET /api/team?unit= → child units of `unit` (default: mine) with their leads (API.md). WARD+ only.
import { createError, defineEventHandler, getQuery } from 'h3'
import { listTeam } from '~~/server/services/team'
import { teamQuerySchema } from '~~/shared/schemas/team'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const query = teamQuerySchema.safeParse(getQuery(event))
  if (!query.success) throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid' } })

  const result = await listTeam(useDb(), user, query.data.unit)
  if (result.kind === 'forbidden') throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  return { unit: result.unit, canManage: result.canManage, members: result.members }
})
