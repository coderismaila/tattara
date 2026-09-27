// Sign the shared test users in once (new device → OTP from the fake outbox) and save their sessions for reuse.
import { expect, test as setup, type Page } from '@playwright/test'
import { AUTH_STATE_FILE, DEV_PIN, PU_AUTH_STATE_FILE, PU_USER_PHONE, SHELL_USER_PHONE, latestOtp } from './support/env'

async function signIn(page: Page, phone: string, stateFile: string) {
  const e164 = `+234${phone.slice(1)}`
  await page.goto('/login')
  await page.getByTestId('login-phone').fill(phone)
  await page.getByTestId('login-pin').fill(DEV_PIN)
  await page.getByTestId('login-submit').click()

  await expect(page.getByTestId('login-code')).toBeVisible()
  await expect.poll(() => latestOtp(e164)).toMatch(/^\d{6}$/)
  await page.getByTestId('login-code').fill(latestOtp(e164)!)
  await page.getByTestId('code-submit').click()

  await expect(page).toHaveURL(/\/app$/)
  await page.context().storageState({ path: stateFile })
}

setup('sign in the app-shell user (Kano ward lead)', async ({ page }) => {
  await signIn(page, SHELL_USER_PHONE, AUTH_STATE_FILE)
})

setup('sign in the capture user (Kano PU lead)', async ({ page }) => {
  await signIn(page, PU_USER_PHONE, PU_AUTH_STATE_FILE)
})
