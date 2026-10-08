// GET /api/flags?status=open|reviewed&type=&unit=&cursor=&limit= → { items, nextCursor, openCounts } (API.md, task 5.4).
// Ward, LGA and state leads (own unit) and the DG (everything). Ward leads see supporters in full, the rest masked.
import { createError, defineEventHandler } from 'h3'
import { listFlags } from '~~/server/services/flag-review'
import { flagListQuerySchema } from '~~/shared/schemas/flags'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { readValidatedQuery } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const query = readValidatedQuery(event, flagListQuerySchema)
  const result = await listFlags(useDb(), user, query)
  if (result.kind === 'forbidden') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  return result.body
})
