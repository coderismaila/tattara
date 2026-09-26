// Map an API error (FetchError from $fetch) to an i18n key + params for the auth screens.
export interface AuthErrorMessage {
  key: string
  params?: Record<string, number>
}

const KNOWN = new Set([
  'invalid_credentials', 'locked', 'rate_limited', 'code_invalid', 'code_expired', 'code_attempts',
  'invite_invalid', 'invite_expired', 'unit_taken',
])

export function authErrorMessage(error: unknown): AuthErrorMessage {
  const e = error as { statusCode?: number, data?: { data?: { reason?: string, retryAfterSec?: number, issues?: { message: string }[] } } }
  if (!e?.statusCode) return { key: 'auth.errors.network' }
  const data = e.data?.data
  const reason = data?.reason
  if (reason === 'invalid' && data?.issues?.[0]?.message) return { key: data.issues[0].message }
  if (reason && KNOWN.has(reason)) {
    const minutes = data?.retryAfterSec ? Math.max(1, Math.ceil(data.retryAfterSec / 60)) : undefined
    return { key: `auth.errors.${reason}`, ...(minutes !== undefined && { params: { minutes } }) }
  }
  return { key: 'auth.errors.unknown' }
}
