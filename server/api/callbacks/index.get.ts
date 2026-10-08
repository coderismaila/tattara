// GET /api/callbacks?date=YYYY-MM-DD → { date, items, passRate } (API.md, task 5.3). Ward leads only: their ward's
// calls due that day (default: today in Lagos) plus any still open from earlier days. Full name and phone: the ward
// lead calls them (SECURITY_PRIVACY §3).
import { createError, defineEventHandler } from 'h3'
import { listCallbacks } from '~~/server/services/callbacks'
import { callbackListQuerySchema } from '~~/shared/schemas/callbacks'
import { lagosDate } from '~~/shared/utils/lagos-date'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { readValidatedQuery } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const { date } = readValidatedQuery(event, callbackListQuerySchema)
  const result = await listCallbacks(useDb(), user, date ?? lagosDate())
  if (result.kind === 'forbidden') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  return { date: result.date, items: result.items, passRate: result.passRate }
})
