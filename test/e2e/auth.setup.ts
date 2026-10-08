// Sign the shared test users in once (new device → OTP from the fake outbox) and save their sessions for reuse.
import { expect, test as setup, type Page } from '@playwright/test'
import { AUTH_STATE_FILE, DEV_PIN, LGA_AUTH_STATE_FILE, LGA_USER_PHONE, PU_AUTH_STATE_FILE, PU_USER_PHONE, SHELL_USER_PHONE, latestOtp, newOtp } from './support/env'

async function signIn(page: Page, phone: string, stateFile: string) {
  const e164 = `+234${phone.slice(1)}`
  await page.goto('/login')
  await page.getByTestId('login-phone').fill(phone)
  await page.getByTestId('login-pin').fill(DEV_PIN)
  const before = latestOtp(e164) // the access setup may already have signed this user in
  await page.getByTestId('login-submit').click()

  await expect(page.getByTestId('login-code')).toBeVisible()
  await expect.poll(() => newOtp(e164, before)).toMatch(/^\d{6}$/)
  await page.getByTestId('login-code').fill(latestOtp(e164)!)
  await page.getByTestId('code-submit').click()

  await expect(page).toHaveURL(/\/app$/)
  // indexedDB: the local session and PIN verifier (4.5); without them /app shows "sign in again".
  await page.context().storageState({ path: stateFile, indexedDB: true })
}

setup('sign in the app-shell user (Kano ward lead)', async ({ page }) => {
  await signIn(page, SHELL_USER_PHONE, AUTH_STATE_FILE)
})

setup('sign in the capture user (Kano PU lead)', async ({ page }) => {
  await signIn(page, PU_USER_PHONE, PU_AUTH_STATE_FILE)
})

setup('sign in the flag reviewer above ward (Kano LGA lead)', async ({ page }) => {
  await signIn(page, LGA_USER_PHONE, LGA_AUTH_STATE_FILE)
})
