// PATCH /api/supporters/:id { editable fields } → the updated supporter (API.md). The PU lead of its PU only.
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { flagAfterWrite } from '~~/server/services/flags'
import { serializeSupporter, updateSupporter } from '~~/server/services/supporters'
import { supporterPatchSchema } from '~~/shared/schemas/supporter'
import { requireAuth } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { supporterIdParam, supporterNotFound } from '~~/server/utils/supporter-http'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const id = supporterIdParam(getRouterParam(event, 'id'))
  if (user.role !== 'PU_LEAD') throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
  const patch = await readValidated(event, supporterPatchSchema)
  const result = await updateSupporter(useDb(), user, id, patch)
  switch (result.kind) {
    case 'ok':
      // A new phone number may now be shared (duplicate_phone, 5.1).
      if (result.changed.includes('phone')) await flagAfterWrite(useDb(), [id], Number(useRuntimeConfig().public.gpsFlagMeters))
      return { supporter: serializeSupporter(result.supporter, user.role), changed: result.changed }
    case 'invalid':
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid' } })
    case 'phone_limit':
      throw createError({ statusCode: 409, statusMessage: 'Conflict', data: { reason: 'phone_limit' } })
    case 'forbidden':
    case 'anonymised':
      throw supporterNotFound()
  }
})
