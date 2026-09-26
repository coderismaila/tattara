// HTTP mapping shared by the /api/team/:userId routes.
import { createError } from 'h3'
import { isUuidV7 } from '../../shared/utils/uuid.ts'

/** 400 unless the route param is a UUIDv7 (our user ids). */
export function userIdParam(value: string | undefined): string {
  if (!isUuidV7(value)) throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid' } })
  return value
}

/** Unknown users and users outside your team both answer 403, so ids can't be probed across units. */
export function teamTargetError(kind: 'forbidden' | 'not_found' | 'already_deactivated') {
  return kind === 'already_deactivated'
    ? createError({ statusCode: 409, statusMessage: 'Conflict', data: { reason: 'already_deactivated' } })
    : createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'not_your_unit' } })
}
