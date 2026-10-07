// Task 4.5: idle lock with an offline PIN check, wipe after too many wrong PINs, wipe on sign-out, and "sign in again"
// on a phone that has no local session. The E2E server's idle limit is 120 min (playwright.config.ts); the tests
// fast-forward the page clock past it.
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { DEV_PIN, PU_AUTH_STATE_FILE } from './support/env'
import { localMetaKeys } from './support/offline'

test.use({ storageState: PU_AUTH_STATE_FILE }) // Kano PU lead, signed in with a local session

async function openThenIdle(page: Page) {
  await page.clock.install()
  await page.goto('/app')
  await expect(page.locator('header')).toBeVisible()
  await expect(page.getByTestId('app-lock')).toHaveCount(0)
  await page.clock.fastForward('02:01:00')
  await expect(page.getByTestId('app-lock')).toHaveAttribute('data-state', 'locked')
}

test('the app locks after the idle time and unlocks offline with the PIN', async ({ page, context }) => {
  await openThenIdle(page)
  // The page behind is hidden and out of reach for taps, keys and screen readers.
  await expect(page.locator('header')).toBeHidden()
  expect(await page.locator('[inert]').count()).toBeGreaterThan(0)
  await expect(page.getByTestId('lock-pin')).toBeFocused()

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])

  await context.setOffline(true)
  try {
    await page.getByTestId('lock-pin').fill('12')
    await page.getByTestId('lock-submit').click()
    await expect(page.getByTestId('lock-error')).toHaveText('PIN lamba 6 ne.') // format, not counted

    await page.getByTestId('lock-pin').fill('000000')
    await page.getByTestId('lock-submit').click()
    await expect(page.getByTestId('lock-error')).toContainText('Saura gwaji 4')

    await page.getByTestId('lock-pin').fill(DEV_PIN)
    await page.getByTestId('lock-submit').click()
    await expect(page.getByTestId('app-lock')).toHaveCount(0)
    await expect(page.locator('header')).toBeVisible()
  }
  finally {
    await context.setOffline(false)
  }
})

test('five wrong PINs delete the local data and sign out', async ({ page }) => {
  await openThenIdle(page)
  expect(await localMetaKeys(page)).toEqual(expect.arrayContaining(['session', 'pinVerifier']))

  for (const left of [4, 3, 2, 1]) {
    await page.getByTestId('lock-pin').fill('000000')
    await page.getByTestId('lock-submit').click()
    await expect(page.getByTestId('lock-error')).toContainText(`Saura gwaji ${left}`)
  }
  await page.getByTestId('lock-pin').fill('000000')
  await page.getByTestId('lock-submit').click()

  await expect(page).toHaveURL(/\/login$/)
  expect(await localMetaKeys(page)).toEqual([])
})

test('signing out from Settings deletes the local data', async ({ page }) => {
  await page.goto('/app/settings')
  await expect(page.getByTestId('sign-out')).toBeVisible()
  expect(await localMetaKeys(page)).toEqual(expect.arrayContaining(['session', 'pinVerifier']))

  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await localMetaKeys(page)).toEqual([])
})

test('a phone with a session cookie but no local session asks to sign in again', async ({ browser }) => {
  // The cookie alone (as on a phone from before 4.5, or one wiped offline): /app stays covered.
  const { cookies } = JSON.parse(readFileSync(PU_AUTH_STATE_FILE, 'utf8')) as { cookies: [] }
  const context = await browser.newContext({ storageState: { cookies, origins: [] } })
  const page = await context.newPage()
  try {
    await page.goto('/app')
    await expect(page.getByTestId('app-lock')).toHaveAttribute('data-state', 'needsSignIn')
    await expect(page.getByTestId('lock-needs-sign-in')).toContainText('ku shiga da lambar wayarku')
    await page.getByTestId('lock-sign-in').click()
    await expect(page).toHaveURL(/\/login$/)
  }
  finally {
    await context.close()
  }
})
