// HTTP helpers shared by the /api/supporters/:id routes.
import { createError } from 'h3'
import { isUuidV7 } from '../../shared/utils/uuid.ts'

/** Unknown, anonymised and out-of-scope supporters all answer 404, so ids can't be probed across units. */
export const supporterNotFound = () => createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })

/** The :id param, or 404 when it isn't a UUIDv7 (our supporter ids). */
export function supporterIdParam(value: string | undefined): string {
  if (!isUuidV7(value)) throw supporterNotFound()
  return value
}
