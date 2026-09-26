// Map a Team API error to an i18n key + params (same shape as authErrorMessage).
const KNOWN = new Set(['not_your_unit', 'unit_has_active_lead', 'already_active', 'phone_in_use', 'already_deactivated', 'rate_limited'])

export function teamErrorMessage(error: unknown): AuthErrorMessage {
  const e = error as { statusCode?: number, data?: { data?: { reason?: string, retryAfterSec?: number, issues?: { message: string }[] } } }
  if (!e?.statusCode) return { key: 'auth.errors.network' }
  const data = e.data?.data
  if (data?.reason === 'invalid' && data.issues?.[0]?.message) return { key: data.issues[0].message }
  if (data?.reason && KNOWN.has(data.reason)) {
    const minutes = data.retryAfterSec ? Math.max(1, Math.ceil(data.retryAfterSec / 60)) : undefined
    return { key: `team.errors.${data.reason}`, ...(minutes !== undefined && { params: { minutes } }) }
  }
  if (e.statusCode === 403) return { key: 'team.errors.not_your_unit' }
  return { key: 'auth.errors.unknown' }
}
