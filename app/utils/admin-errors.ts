// Map an Admin API error to an i18n key + params (same shape as teamErrorMessage).
const KNOWN = new Set(['dg_exists', 'phone_in_use', 'admin_only', 'rate_limited'])

export function adminErrorMessage(error: unknown): AuthErrorMessage {
  const e = error as { statusCode?: number, data?: { data?: { reason?: string, retryAfterSec?: number, issues?: { message: string }[] } } }
  if (!e?.statusCode) return { key: 'auth.errors.network' }
  const data = e.data?.data
  if (data?.reason === 'invalid' && data.issues?.[0]?.message) return { key: data.issues[0].message }
  if (data?.reason && KNOWN.has(data.reason)) {
    const minutes = data.retryAfterSec ? Math.max(1, Math.ceil(data.retryAfterSec / 60)) : undefined
    return { key: `admin.errors.${data.reason}`, ...(minutes !== undefined && { params: { minutes } }) }
  }
  if (e.statusCode === 403) return { key: 'admin.errors.admin_only' }
  return { key: 'auth.errors.unknown' }
}
