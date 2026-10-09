// Request size limit for the API (task 7.1, ADR-050): 64 KB, 1 MB for sync push. Checked on Content-Length before
// anything reads the body; a write without a length (chunked) gets 411, so the limit can't be dodged.
import { createError, defineEventHandler, getRequestHeader, getRequestURL } from 'h3'
import { bodyLimitFor } from '../utils/security-headers.ts'

const WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler((event) => {
  if (!WITH_BODY.has(event.method)) return
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return

  const header = getRequestHeader(event, 'content-length')
  if (header === undefined) {
    if (getRequestHeader(event, 'transfer-encoding')) {
      throw createError({ statusCode: 411, statusMessage: 'Length Required', data: { reason: 'length_required' } })
    }
    return // no body at all
  }
  if (Number(header) > bodyLimitFor(path)) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large', data: { reason: 'too_large' } })
  }
})
