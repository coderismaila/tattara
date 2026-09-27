// Task 3.7 (US-24): the PU lead is asked once for their PU's registered voters and records them; the ward lead
// sees the figure on the Team page and corrects it; Home shows the ward's sum and "reported for X of Y".
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { AUTH_STATE_FILE, DEV_PIN, VOTERS_PU, VOTERS_USER_PHONE, latestOtp } from './support/env'

test.describe.serial('registered voters from the field', () => {
  test('the PU lead is prompted once, records the figure and can update it', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-phone').fill(VOTERS_USER_PHONE)
    await page.getByTestId('login-pin').fill(DEV_PIN)
    await page.getByTestId('login-submit').click()
    const e164 = `+234${VOTERS_USER_PHONE.slice(1)}`
    await expect.poll(() => latestOtp(e164)).toMatch(/^\d{6}$/)
    await page.getByTestId('login-code').fill(latestOtp(e164)!)
    await page.getByTestId('code-submit').click()
    await expect(page).toHaveURL(/\/app$/)

    // Missing figure: the dialog opens by itself.
    await expect(page.getByTestId('voters-input')).toBeVisible()
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])

    await page.getByTestId('voters-input').fill('abc')
    await page.getByTestId('voters-save').click()
    await expect(page.getByText('Shigar da cikakken lamba, 0 ko fiye.')).toBeVisible()

    await page.getByTestId('voters-input').fill('380')
    await page.getByTestId('voters-save').click()
    await expect(page.getByTestId('home-voters-value')).toHaveText('380')

    // Asked only once: a reload doesn't open the dialog again, and the card offers "Update".
    await page.reload()
    await expect(page.getByTestId('home-voters-value')).toHaveText('380')
    await expect(page.getByTestId('voters-input')).toHaveCount(0)
    await page.getByTestId('home-voters-edit').click()
    await page.getByTestId('voters-input').fill('385')
    await page.getByTestId('voters-save').click()
    await expect(page.getByTestId('home-voters-value')).toHaveText('385')
  })

  test.describe('as the ward lead', () => {
    test.use({ storageState: AUTH_STATE_FILE }) // Kano ward lead, 19/01/01

    test('sees and corrects the PU figure on the Team page', async ({ page }) => {
      await page.goto('/app/team')
      await expect(page.getByTestId(`team-voters-${VOTERS_PU}`)).toContainText('385')
      await page.getByTestId(`team-voters-edit-${VOTERS_PU}`).click()
      await expect(page.getByTestId('voters-input')).toHaveValue('385')
      await page.getByTestId('voters-input').fill('390')
      await page.getByTestId('voters-save').click()
      await expect(page.getByTestId(`team-voters-${VOTERS_PU}`)).toContainText('390')
    })

    test('Home shows the ward total and how many PUs have reported', async ({ page }) => {
      await page.goto('/app')
      await expect(page.getByTestId('home-voters-coverage')).toHaveText(/An rubuta na rumfuna \d+ cikin 10/)
      await expect(page.getByTestId('home-voters-value')).toHaveText(/^[\d,]+$/)
      await expect(page.getByTestId('home-voters-edit')).toHaveCount(0)
    })
  })
})
