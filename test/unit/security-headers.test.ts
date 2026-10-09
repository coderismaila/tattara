// Task 7.1: inline-script hashing for the page CSP, where the meta tag goes, the CSP itself, headers and body limits.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BODY_LIMIT_BYTES,
  SECURITY_HEADERS,
  SYNC_PUSH_BODY_LIMIT_BYTES,
  bodyLimitFor,
  inlineScriptHashes,
  pageCsp,
  withCspMeta,
} from '../../server/utils/security-headers'

const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`

describe('inlineScriptHashes', () => {
  it('hashes inline executable scripts (classic, module, importmap) exactly as written', () => {
    const html = '<script>window.__NUXT__={}</script><script type="module">import "x"</script>'
      + '<script type="importmap">{"imports":{}}</script>'
    expect(inlineScriptHashes(html)).toEqual([sha('window.__NUXT__={}'), sha('import "x"'), sha('{"imports":{}}')])
  })

  it('skips external scripts and JSON data, and deduplicates', () => {
    const html = '<script type="module" src="/_nuxt/a.js" crossorigin></script>'
      + '<script type="application/json" id="__NUXT_DATA__">[1]</script>'
      + '<script>a()</script><script>a()</script>'
    expect(inlineScriptHashes(html)).toEqual([sha('a()')])
  })

  it('keeps whitespace and multi-line bodies byte for byte', () => {
    const body = '\n  (function(){\n    var x = 1\n  })()\n'
    expect(inlineScriptHashes(`<script>${body}</script>`)).toEqual([sha(body)])
  })
})

describe('pageCsp', () => {
  it('allows only own-origin scripts plus the given hashes, never unsafe-inline or eval for scripts', () => {
    const csp = pageCsp(['\'sha256-abc\''])
    const script = csp.split('; ').find(d => d.startsWith('script-src'))
    expect(script).toBe('script-src \'self\' \'sha256-abc\'')
    expect(csp).not.toMatch(/script-src[^;]*unsafe/)
    expect(csp).toContain('default-src \'self\'')
    expect(csp).toContain('connect-src \'self\'')
    expect(csp).toContain('object-src \'none\'')
  })
})

describe('withCspMeta', () => {
  it('goes right after the charset so it governs every script that follows', () => {
    const head = ['<meta charset="utf-8"><meta name="viewport" content="x"><script>a()</script>', '<link rel="x">']
    const out = withCspMeta(head, 'script-src \'self\' \'sha256-a"b\'')
    expect(out[0]).toBe('<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'sha256-a&quot;b\'"><meta name="viewport" content="x"><script>a()</script>')
    expect(out[1]).toBe('<link rel="x">')
  })

  it('goes first without a charset tag', () => {
    expect(withCspMeta(['<title>x</title>'], 'default-src \'self\'')[0]).toMatch(/^<meta http-equiv="Content-Security-Policy"/)
  })
})

describe('headers and limits', () => {
  it('sends HSTS, nosniff, same-origin referrer, no framing and geolocation-only permissions', () => {
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toMatch(/max-age=31536000/)
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff')
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('same-origin')
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain('frame-ancestors \'none\'')
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('geolocation=(self)')
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('camera=()')
  })

  it('allows 1 MB for sync push and 64 KB elsewhere', () => {
    expect(bodyLimitFor('/api/sync/push')).toBe(SYNC_PUSH_BODY_LIMIT_BYTES)
    expect(bodyLimitFor('/api/sync/push?x=1')).toBe(SYNC_PUSH_BODY_LIMIT_BYTES)
    expect(bodyLimitFor('/api/supporters/abc')).toBe(BODY_LIMIT_BYTES)
  })
})
