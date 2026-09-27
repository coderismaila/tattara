// GET /api/supporters/:id → the supporter, full for PU/ward leads in scope (API.md). Others: 404.
import { defineEventHandler, getRouterParam } from 'h3'
import { getSupporter, serializeSupporter } from '~~/server/services/supporters'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { supporterIdParam, supporterNotFound } from '~~/server/utils/supporter-http'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const id = supporterIdParam(getRouterParam(event, 'id'))
  const row = await getSupporter(useDb(), user, id)
  if (!row || row.status === 'anonymised') throw supporterNotFound()
  return { supporter: serializeSupporter(row, user.role), canEdit: user.role === 'PU_LEAD' }
})
