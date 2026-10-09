// POST /api/targets/:code/distribute { method: 'proportional', preview? } → the split (API.md, task 6.4). The lead of
// :code splits their own target across the units below, by registered voters or, where figures are missing, by PU
// count. `preview` saves nothing. 409 `no_target` / `no_children`. Audited when saved.
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { distributeTarget } from '~~/server/services/targets'
import { distributeSchema } from '~~/shared/schemas/targets'
import { fromUrlCode } from '~~/shared/utils/pu-code'
import { useDb } from '~~/server/utils/db'
import { requireAuth } from '~~/server/utils/auth'
import { requireScope } from '~~/server/utils/scope'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const code = fromUrlCode(getRouterParam(event, 'code'))
  if (!code) throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
  await requireScope(event, code)
  const { preview } = await readValidated(event, distributeSchema)

  const outcome = await distributeTarget(useDb(), user, code, preview)
  switch (outcome.kind) {
    case 'ok':
      return outcome.result
    case 'forbidden':
      throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_allowed' } })
    case 'not_found':
      throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
    case 'no_target':
    case 'no_children':
      throw createError({ statusCode: 409, statusMessage: 'Conflict', data: { reason: outcome.kind } })
  }
})
