// Sign the shell-test user in once (new device → OTP from the fake outbox) and save the session for reuse.
import { expect, test as setup } from '@playwright/test'
import { AUTH_STATE_FILE, DEV_PIN, SHELL_USER_PHONE, latestOtp } from './support/env'

setup('sign in the app-shell user', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-phone').fill(SHELL_USER_PHONE)
  await page.getByTestId('login-pin').fill(DEV_PIN)
  await page.getByTestId('login-submit').click()

  await expect(page.getByTestId('login-code')).toBeVisible()
  await expect.poll(() => latestOtp('+2348000000103')).toMatch(/^\d{6}$/)
  await page.getByTestId('login-code').fill(latestOtp('+2348000000103')!)
  await page.getByTestId('code-submit').click()

  await expect(page).toHaveURL(/\/app$/)
  await page.context().storageState({ path: AUTH_STATE_FILE })
})
