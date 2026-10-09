// Task 7.1: security headers on pages, static files and the API; the hashed page CSP in the prerendered landing page
// and the /app shell; no CSP violation while using the main screens (map and its worker included); body size limit;
// per-phone OTP verify limit.
import { expect, test, type Page } from '@playwright/test'
import { newId } from '../../shared/utils/uuid'
import { AUTH_STATE_FILE, E2E_PORT, PU_AUTH_STATE_FILE } from './support/env'

const ORIGIN = { Origin: `http://localhost:${E2E_PORT}` }

/** Collect CSP violations (the DOM event) and the console errors browsers print for them. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const consoleHits: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) consoleHits.push(m.text())
  })
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', e => w.__csp.push(`${e.violatedDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} on ${location.pathname}`))
  })
  return async () => [...consoleHits, ...await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])]
}

test.describe('headers', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of ['/', '/app', '/api/auth/me', '/manifest.webmanifest']) {
    test(`security headers on ${path}`, async ({ request }) => {
      const res = await request.get(path)
      const h = res.headers()
      expect(h['strict-transport-security']).toContain('max-age=31536000')
      expect(h['x-content-type-options']).toBe('nosniff')
      // Error responses (signed out: 401) get Nitro's own, stricter no-referrer.
      expect(['same-origin', 'no-referrer']).toContain(h['referrer-policy'])
      expect(h['x-frame-options']).toBe('DENY')
      expect(h['content-security-policy']).toContain('frame-ancestors \'none\'')
      expect(h['permissions-policy']).toContain('geolocation=(self)')
      expect(h['x-powered-by']).toBeUndefined()
    })
  }

  for (const path of ['/', '/app']) {
    test(`hashed page CSP right after the charset on ${path}`, async ({ request }) => {
      const html = await (await request.get(path)).text()
      expect(html).toMatch(/<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+;/)
      expect(html).not.toMatch(/script-src[^;"]*unsafe/)
    })
  }
})

test.describe('no CSP violations (ward lead)', () => {
  test.use({ storageState: AUTH_STATE_FILE })

  test('home, map with its worker, targets, activity, review, team', async ({ page }) => {
    const violations = await watchCsp(page)
    await page.goto('/app')
    await expect(page.getByTestId('home-summary')).toBeVisible()
    await page.goto('/app/map')
    await expect.poll(async () => Number(await page.getByTestId('map-canvas').getAttribute('data-rendered')), { timeout: 20_000 }).toBeGreaterThan(0)
    for (const path of ['/app/targets', '/app/activity', '/app/review', '/app/team']) {
      await page.goto(path)
      await expect(page.locator('main h1').first()).toBeVisible()
    }
    expect(await violations()).toEqual([])
  })
})

test.describe('no CSP violations (PU lead)', () => {
  test.use({ storageState: PU_AUTH_STATE_FILE })

  test('home, capture, supporters, sync', async ({ page }) => {
    const violations = await watchCsp(page)
    for (const path of ['/app', '/app/capture', '/app/supporters', '/app/sync']) {
      await page.goto(path)
      await expect(page.locator('main h1').first()).toBeVisible()
    }
    expect(await violations()).toEqual([])
  })
})

test.describe('API limits', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('a body over 64 KB is refused before anything reads it', async ({ request }) => {
    const res = await request.post('/api/auth/login', { headers: ORIGIN, data: { phone: '08000000001', pin: '1'.repeat(70_000), deviceId: newId() } })
    expect(res.status()).toBe(413)
  })

  test('OTP verify allows 10 tries per phone in 15 minutes', async ({ request }) => {
    const phone = '08039990001' // no such lead: every try is a wrong code until the limit
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await request.post('/api/auth/otp/verify', { headers: ORIGIN, data: { phone, code: '000000', deviceId: newId() } })
      statuses.push(res.status())
    }
    expect(statuses.slice(0, 10).every(s => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
