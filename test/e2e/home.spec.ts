import { expect, test } from '@playwright/test'

test.describe('home page', () => {
  // Many field phones are set to English; the app must still open in Hausa.
  test.use({ locale: 'en-US' })

  test('opens in Hausa regardless of the phone language', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tattara')
    await expect(page.getByText('Rijistar magoya baya ta Arewa maso Yamma')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Shiga' })).toBeVisible()
  })
})
