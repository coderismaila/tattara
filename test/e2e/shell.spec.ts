import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { AUTH_STATE_FILE } from './support/env'

// /app needs a session: reuse the one auth.setup.ts saved (seeded Kano ward lead).
test.use({ storageState: AUTH_STATE_FILE })

test.describe('language switch', () => {
  test('switches strings without a reload and remembers the choice', async ({ page }) => {
    await page.goto('/app/settings')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saituna')

    // Mark the document: a full reload would drop this flag.
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))

    await page.getByRole('button', { name: 'English' }).first().click()

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)

    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')

    // Also restored on the prerendered public page.
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()

    await page.getByRole('button', { name: 'Hausa' }).click()
    await expect(page.getByRole('link', { name: 'Shiga' })).toBeVisible()
  })
})

test.describe('app shell', () => {
  test('bottom navigation marks the current page', async ({ page }) => {
    await page.goto('/app')
    const nav = page.getByRole('navigation', { name: 'Babban kewayawa' })
    await expect(nav.getByRole('link', { name: 'Gida' })).toHaveAttribute('aria-current', 'page')

    await nav.getByRole('link', { name: 'Saituna' }).click()
    await expect(page).toHaveURL(/\/app\/settings$/)
    await expect(nav.getByRole('link', { name: 'Saituna' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: 'Gida' })).not.toHaveAttribute('aria-current', 'page')
  })

  test('touch targets are at least 48 px', async ({ page }) => {
    await page.goto('/app')
    await expect(page.getByRole('navigation', { name: 'Babban kewayawa' })).toBeVisible()
    const targets = page.locator('nav[aria-label] a, [data-testid^="lang-"]')
    const count = await targets.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const box = await targets.nth(i).boundingBox()
      if (!box) continue // hidden (e.g. desktop nav on mobile)
      expect(box.height, `target ${i} height`).toBeGreaterThanOrEqual(48)
      expect(box.width, `target ${i} width`).toBeGreaterThanOrEqual(48)
    }
  })

  test('Noto Sans loads and covers Hausa hooked letters', async ({ page }) => {
    await page.goto('/app')
    const faces = await page.evaluate(async () => {
      const loaded = await document.fonts.load('16px "Noto Sans"', 'ɓɗƙƴ ƁƊƘƳ')
      return loaded.map(f => ({ family: f.family, status: f.status }))
    })
    expect(faces.length).toBeGreaterThan(0)
    for (const face of faces) {
      expect(face.family).toContain('Noto Sans')
      expect(face.status).toBe('loaded')
    }
    const fontFamily = await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily)
    expect(fontFamily).toMatch(/Noto Sans/)
  })
})

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  for (const path of ['/', '/app', '/app/settings', '/app/team', '/app/sync', '/app/review', '/app/targets']) {
    test(`no violations on ${path}`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('main')).toBeVisible()
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  }
})

test.describe('accessibility of the sign-in screens (signed out)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of ['/login', `/setup?t=${'x'.repeat(22)}`]) {
    test(`no violations on ${path.split('?')[0]}`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('form')).toBeVisible()
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  }
})
