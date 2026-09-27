// GET /api/supporters?q=&pu=&cursor=&limit= → { items, nextCursor } (API.md). PU lead: own PU; ward lead: own ward.
import { createError, defineEventHandler } from 'h3'
import { listSupporters, serializeSupporter } from '~~/server/services/supporters'
import { supporterListQuerySchema } from '~~/shared/schemas/supporter'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { readValidatedQuery } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const query = readValidatedQuery(event, supporterListQuerySchema)
  const result = await listSupporters(useDb(), user, query)
  if (result.kind === 'forbidden') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_your_unit' } })
  return { items: result.items.map(row => serializeSupporter(row, user.role)), nextCursor: result.nextCursor }
})
