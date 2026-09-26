// CSRF defence for cookie-authenticated APIs (API.md conventions): state-changing /api requests must come from our own
// origin (Origin header, else Referer). SameSite=Lax cookies cover most cases; this closes the rest.
// Provider webhooks (/api/webhooks/*) are exempt: they authenticate by signature instead.
import { createError, defineEventHandler, getRequestHeader, getRequestURL } from 'h3'

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isSameOrigin(source: string | undefined, requestUrl: URL): boolean {
  if (!source) return false
  try {
    return new URL(source).origin === requestUrl.origin
  }
  catch {
    return false
  }
}

export default defineEventHandler((event) => {
  if (!UNSAFE.has(event.method)) return
  const url = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })
  if (!url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/webhooks/')) return

  const source = getRequestHeader(event, 'origin') ?? getRequestHeader(event, 'referer')
  if (!isSameOrigin(source, url)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { reason: 'bad_origin' } })
  }
})
