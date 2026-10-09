// Security headers and the page CSP (SECURITY_PRIVACY §6, task 7.1, ADR-050). Pure: the Nitro plugin in
// server/plugins/security-headers.ts applies them. Inline scripts are allowed by SHA-256 hash, never 'unsafe-inline':
// the landing page is prerendered and the /app shell is cached offline by the service worker, so per-request nonces
// can't work; hashes travel with the HTML in a <meta> CSP.
import { createHash } from 'node:crypto'

/** Everything but geolocation (GPS on capture) is switched off. */
export const PERMISSIONS_POLICY = [
  'geolocation=(self)',
  'camera=()',
  'microphone=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
  'hid=()',
  'midi=()',
  'display-capture=()',
  'accelerometer=()',
  'gyroscope=()',
  'magnetometer=()',
  'browsing-topics=()',
].join(', ')

/** The directives a <meta> CSP can't carry (frame-ancestors) or that hold for every response. */
export const HEADER_CSP = [
  'frame-ancestors \'none\'',
  'base-uri \'self\'',
  'object-src \'none\'',
  'form-action \'self\'',
].join('; ')

/** Sent on every response (static files, API and pages). */
export const SECURITY_HEADERS: Record<string, string> = {
  // Browsers ignore HSTS over plain HTTP, so local development is unaffected.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': HEADER_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': PERMISSIONS_POLICY,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

/** Script types the browser executes (and CSP governs); JSON payload scripts are data. */
const EXECUTABLE = new Set(['', 'text/javascript', 'application/javascript', 'module', 'importmap'])
const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi

/** `'sha256-…'` sources for every inline executable script in `html`, deduplicated, in order of appearance. */
export function inlineScriptHashes(html: string): string[] {
  const out = new Set<string>()
  for (const [, attrs = '', body = ''] of html.matchAll(SCRIPT)) {
    if (/\ssrc\s*=/i.test(` ${attrs}`)) continue
    const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(` ${attrs}`)?.[1]?.toLowerCase() ?? ''
    if (!EXECUTABLE.has(type)) continue
    out.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }
  return [...out]
}

/** The page CSP: own origin only; inline scripts by hash; inline styles allowed (Vue/Nuxt UI/MapLibre set them). */
export function pageCsp(scriptHashes: readonly string[]): string {
  return [
    'default-src \'self\'',
    `script-src 'self'${scriptHashes.map(h => ` ${h}`).join('')}`,
    'style-src \'self\' \'unsafe-inline\'',
    'img-src \'self\' data: blob:',
    'font-src \'self\' data:',
    'connect-src \'self\'',
    'worker-src \'self\'',
    'manifest-src \'self\'',
    'frame-src \'none\'',
    'object-src \'none\'',
    'base-uri \'self\'',
    'form-action \'self\'',
  ].join('; ')
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/**
 * Head chunks with the CSP <meta> placed right after `<meta charset>` (a meta CSP only governs what follows it, and
 * the charset must stay within the first 1024 bytes). Without a charset tag it goes first.
 */
export function withCspMeta(head: readonly string[], csp: string): string[] {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">`
  const charset = /<meta\s+charset=["']?[^"'>]+["']?\s*\/?>/i
  const i = head.findIndex(chunk => charset.test(chunk))
  if (i === -1) return [tag, ...head]
  return head.map((chunk, j) => (j === i ? chunk.replace(charset, m => `${m}${tag}`) : chunk))
}

/** Default /api body limit, and the larger one for sync push (≤ 50 supporters per request). */
export const BODY_LIMIT_BYTES = 64 * 1024
export const SYNC_PUSH_BODY_LIMIT_BYTES = 1024 * 1024

export function bodyLimitFor(path: string): number {
  return path.split('?')[0] === '/api/sync/push' ? SYNC_PUSH_BODY_LIMIT_BYTES : BODY_LIMIT_BYTES
}
