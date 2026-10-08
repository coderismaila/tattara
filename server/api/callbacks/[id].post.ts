// POST /api/callbacks/:id { outcome, notes? } → { item } (API.md, task 5.3). The ward lead of the call's ward only:
// other ward leads get 404, other roles 403. Once recorded, an outcome can't be changed (409 already_done).
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { completeCallback } from '~~/server/services/callbacks'
import { callbackOutcomeSchema } from '~~/shared/schemas/callbacks'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { readValidated } from '~~/server/utils/validate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const notFound = () => createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  if (user.role !== 'WARD_LEAD') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  const id = getRouterParam(event, 'id') ?? ''
  if (!UUID.test(id)) throw notFound()
  const input = await readValidated(event, callbackOutcomeSchema)
  const result = await completeCallback(useDb(), user, id, input)
  switch (result.kind) {
    case 'ok':
      return { item: result.item }
    case 'already_done':
      throw createError({ statusCode: 409, statusMessage: 'Conflict', data: { reason: 'already_done' } })
    case 'forbidden':
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
    case 'not_found':
      throw notFound()
  }
})
