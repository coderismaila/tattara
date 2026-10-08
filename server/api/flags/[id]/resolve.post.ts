// POST /api/flags/:id/resolve { status: dismissed | confirmed, note? } → { flag } (API.md, task 5.4). Any reviewer whose
// scope holds the flag's PU; a later review overrules an earlier one. Out of scope 404, other roles 403.
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { FLAG_REVIEW_ROLES, resolveFlag } from '~~/server/services/flag-review'
import { flagResolveSchema } from '~~/shared/schemas/flags'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { readValidated } from '~~/server/utils/validate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const notFound = () => createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  if (!FLAG_REVIEW_ROLES.includes(user.role)) throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  const id = getRouterParam(event, 'id') ?? ''
  if (!UUID.test(id)) throw notFound()
  const input = await readValidated(event, flagResolveSchema)
  const result = await resolveFlag(useDb(), user, id, input)
  if (result.kind === 'forbidden') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  if (result.kind === 'not_found') throw notFound()
  return { flag: result.flag }
})
