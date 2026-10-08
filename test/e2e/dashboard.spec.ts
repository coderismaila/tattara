// Task 6.2: role-aware home. PU lead: numbers + Add supporter, still there offline, and the ward-and-above dashboard
// code is never downloaded. Ward and LGA leads: summary, open flags, units below lowest coverage first, drill-down to
// Team. Axe-clean.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { AUTH_STATE_FILE, LGA_AUTH_STATE_FILE, PU_AUTH_STATE_FILE, ROOT } from './support/env'

/** The built chunk holding the ward-and-above dashboard (found by a test id only it renders; names are hashed). */
function dashboardChunk(): string {
  const dir = join(ROOT, '.output/public/_nuxt')
  const hits = readdirSync(dir).filter(f => f.endsWith('.js') && readFileSync(join(dir, f), 'utf8').includes('home-summary-supporters'))
  expect(hits, 'exactly one chunk holds the dashboard').toHaveLength(1)
  return hits[0]!
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(x => x.target.join(' ')).join(', ')}`)).toEqual([])
}

/** JS files the page loaded. */
function scripts(page: Page) {
  const urls: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') urls.push(r.url())
  })
  return urls
}

test.describe('PU lead home', () => {
  test.use({ storageState: PU_AUTH_STATE_FILE })

  test('today, waiting, total vs target and Add supporter; no dashboard code', async ({ page }) => {
    const loaded = scripts(page)
    await page.goto('/app')
    await expect(page.getByTestId('home-add')).toHaveAttribute('href', '/app/capture')
    await expect(page.getByTestId('home-total-value')).toHaveText(/^[\d,]+$/)
    await expect(page.getByTestId('home-today')).toHaveText(/^[\d,]+$/)
    await expect(page.getByTestId('home-pending')).toHaveText(/^[\d,]+$/)
    await axe(page)
    expect(loaded.filter(u => u.endsWith(`/${dashboardChunk()}`))).toEqual([])
  })

  test('keeps its numbers offline', async ({ page, context }) => {
    await page.goto('/app')
    await expect(page.getByTestId('home-total-value')).toHaveText(/^[\d,]+$/)
    const total = await page.getByTestId('home-total-value').textContent()
    // Let the service worker take control, so an offline reload gets the cached shell (4.1).
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    await context.setOffline(true)
    try {
      await page.reload()
      await expect(page.getByTestId('home-cached')).toContainText('babu intanet')
      await expect(page.getByTestId('home-total-value')).toHaveText(total!)
      await expect(page.getByTestId('home-add')).toBeVisible()
    }
    finally {
      await context.setOffline(false)
    }
  })
})

test.describe('ward lead home', () => {
  test.use({ storageState: AUTH_STATE_FILE })

  test('summary, open flags and the PUs lowest coverage first', async ({ page }) => {
    const loaded = scripts(page)
    await page.goto('/app')
    await expect(page.getByTestId('home-summary-supporters')).toHaveText(/^[\d,]+$/)
    await expect(page.getByTestId('home-flags')).toHaveAttribute('href', '/app/review')
    const rows = page.locator('[data-testid^="home-child-19/01/01/"]')
    await expect(rows).toHaveCount(10)
    const coverage = (await page.getByTestId('home-child-coverage').allTextContents()).map(s => s.replace(/^.*: /, '').trim())
    const values = coverage.filter(c => c !== '—').map(c => Number.parseFloat(c))
    expect(values).toEqual([...values].sort((a, b) => a - b))
    const firstMissing = coverage.indexOf('—')
    if (firstMissing >= 0) expect(coverage.slice(firstMissing).every(c => c === '—')).toBe(true)
    await axe(page)
    expect(loaded.some(u => u.endsWith(`/${dashboardChunk()}`))).toBe(true) // the lazy chunk, loaded here
  })
})

test.describe('LGA lead home', () => {
  test.use({ storageState: LGA_AUTH_STATE_FILE })

  test('lists the wards and drills down to a ward’s team', async ({ page }) => {
    await page.goto('/app')
    const ward = page.getByTestId('home-child-19/01/01')
    await expect(ward).toBeVisible()
    await ward.getByRole('link').click()
    await expect(page).toHaveURL(/\/app\/team\?unit=19-01-01$/)
    await expect(page.getByTestId('team-member-19/01/01/001')).toBeVisible()
    await axe(page)
  })
})
