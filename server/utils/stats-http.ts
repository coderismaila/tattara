// Shared by the /api/stats/* routes (task 6.1): the `:code` segment (dashes, or `all`) checked against the caller's
// scope. Aggregates only, so the admin may read them (SECURITY_PRIVACY §3); `all` is the region (DG and admin).
import { createError, getRouterParam, type H3Event } from 'h3'
import { fromUrlCode } from '../../shared/utils/pu-code.ts'
import { getScope, requireScope } from './scope.ts'

/**
 * The unit code ('' = region) the caller may read, else 401/403/404. `allowAdmin: false` for routes that name leads
 * (user data, not aggregates: the admin has no default access, SECURITY_PRIVACY §3).
 */
export async function statsCode(event: H3Event, { allowAdmin = true }: { allowAdmin?: boolean } = {}): Promise<string> {
  const code = fromUrlCode(getRouterParam(event, 'code'))
  if (code === null) {
    await getScope(event) // 401 before 404 when signed out
    throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
  }
  if (code === '') {
    const scope = await getScope(event)
    if (scope.unitCode !== '' || (!allowAdmin && scope.role === 'ADMIN')) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    return ''
  }
  await requireScope(event, code, { allowAdmin })
  return code
}
