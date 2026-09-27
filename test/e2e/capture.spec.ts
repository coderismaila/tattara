// AC 3.3: capture works keyboard-only, exposes proper roles/labels (TalkBack), and shows required-field errors in
// the active language. Saving goes through POST /api/sync/push (PU leads only).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { AUTH_STATE_FILE, E2E_PORT, PU_AUTH_STATE_FILE } from './support/env'

const ORIGIN = { Origin: `http://localhost:${E2E_PORT}` }

/** Press Tab until `target` (or an element inside it) has focus. Keyboard only, no clicks. */
async function tabTo(page: Page, target: Locator, maxPresses = 40) {
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate(el => el === document.activeElement || el.contains(document.activeElement))) return
    await page.keyboard.press('Tab')
  }
  throw new Error('tabTo: target never received focus')
}

test.describe('capture (PU lead)', () => {
  test.use({
    storageState: PU_AUTH_STATE_FILE,
    permissions: ['geolocation'],
    geolocation: { latitude: 12.0012, longitude: 8.5221, accuracy: 15 },
  })

  test('a supporter can be added with the keyboard only', async ({ page }) => {
    await page.goto('/app/capture')
    await expect(page.getByTestId('capture-pu')).toContainText('19/01/01/001')
    await expect(page.getByTestId('capture-gps')).toContainText('±15 m')
    const name = page.getByTestId('capture-name')
    await expect(name).toBeEnabled()

    // Accessible structure for screen readers: labelled inputs and named radio groups.
    await expect(page.getByRole('textbox', { name: /Cikakken suna/ })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: /Goyon baya/ })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: /Yana da PVC/ })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /Ya amince/ })).toBeVisible()

    await tabTo(page, name)
    await page.keyboard.type('Hauwa Sani')
    await tabTo(page, page.getByTestId('capture-phone'))
    await page.keyboard.type('0803 100 2001')
    await tabTo(page, page.getByTestId('capture-gender'))
    await page.keyboard.press('ArrowRight') // Mace
    await tabTo(page, page.getByTestId('capture-support'))
    await page.keyboard.press('Space') // Sosai
    await tabTo(page, page.getByTestId('capture-pvc'))
    await page.keyboard.press('Space') // E
    await tabTo(page, page.getByTestId('capture-consent-script').locator('summary'))
    await page.keyboard.press('Enter') // open the notice
    await expect(page.getByTestId('capture-consent-text')).toBeVisible()
    await tabTo(page, page.getByTestId('capture-consent'))
    await page.keyboard.press('Space')
    await tabTo(page, page.getByTestId('capture-submit'))
    await page.keyboard.press('Enter')

    await expect(page.getByText('An ajiye', { exact: true })).toBeVisible()
    await expect(page.getByTestId('capture-count')).toHaveText('An ajiye 1 a wannan zama')
    await expect(name).toHaveValue('')
    await expect(name).toBeFocused()
    await expect(page.getByRole('radio', { name: 'Sosai' })).not.toBeChecked()
  })

  test('required-field errors show in the active language', async ({ page }) => {
    await page.goto('/app/capture')
    await expect(page.getByTestId('capture-name')).toBeEnabled()
    await page.getByTestId('capture-submit').click()

    await expect(page.getByText('Shigar da cikakken sunan magoyin baya.')).toBeVisible()
    await expect(page.getByText('Zaɓi matakin goyon baya.')).toBeVisible()
    await expect(page.getByText('Zaɓi ko yana da katin zaɓe (PVC).')).toBeVisible()
    await expect(page.getByText('Karanta masa sanarwar izini kuma ka tabbatar ya amince.')).toBeVisible()
    await expect(page.getByTestId('capture-name')).toBeFocused()

    await page.getByRole('button', { name: 'English' }).first().click()
    await expect(page.getByText('Enter the supporter\'s full name.')).toBeVisible()
    await expect(page.getByText('Choose the level of support.')).toBeVisible()
    await expect(page.getByText('Read the consent notice and tick that they agree.')).toBeVisible()
  })

  test('the consent notice can be read in either language', async ({ page }) => {
    await page.goto('/app/capture')
    await page.getByTestId('capture-consent-script').locator('summary').click()
    await expect(page.getByTestId('capture-consent-text')).toContainText('STOP')
    await expect(page.getByTestId('capture-consent-text')).toHaveAttribute('lang', 'ha')
    await page.getByRole('button', { name: 'English', pressed: false }).last().click()
    await expect(page.getByTestId('capture-consent-text')).toHaveAttribute('lang', 'en')
    await expect(page.getByTestId('capture-consent-text')).toContainText('Do you agree?')
  })

  test('no axe violations on /app/capture', async ({ page }) => {
    await page.goto('/app/capture')
    await expect(page.getByTestId('capture-name')).toBeEnabled()
    await page.getByTestId('capture-consent-script').locator('summary').click()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
})

test.describe('capture for other roles', () => {
  test.use({ storageState: AUTH_STATE_FILE }) // the Kano ward lead

  test('sync push is refused and the page explains why', async ({ page }) => {
    const res = await page.request.post('/api/sync/push', { headers: ORIGIN, data: { items: [{}] } })
    expect(res.status()).toBe(403)
    await page.goto('/app/capture')
    await expect(page.getByText('Shugabannin rumfa ne kaɗai ke ƙara magoya baya.')).toBeVisible()
  })
})
