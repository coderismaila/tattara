// AC 2.4: invited PU lead sets a PIN → logs in → OTP on a second device → locked after 5 bad PINs.
import { expect, test, type Page } from '@playwright/test'
import { LOCKOUT_USER_PHONE, latestOtp, readFixture } from './support/env'

const NEW_PIN = '482915'

async function signIn(page: Page, phone: string, pin: string) {
  await page.goto('/login')
  await page.getByTestId('login-phone').fill(phone)
  await page.getByTestId('login-pin').fill(pin)
  await page.getByTestId('login-submit').click()
}

test.describe.serial('invited PU lead', () => {
  test('sets a PIN from the invite link and lands in the app', async ({ page }) => {
    const { inviteToken } = readFixture()
    await page.goto(`/setup?t=${inviteToken}`)

    // A weak PIN is refused with a clear message.
    await page.getByTestId('setup-pin').fill('123456')
    await page.getByTestId('setup-confirm').fill('123456')
    await page.getByTestId('setup-submit').click()
    await expect(page.getByTestId('auth-error')).toBeVisible()
    await expect(page).toHaveURL(/\/setup/)

    await page.getByTestId('setup-pin').fill(NEW_PIN)
    await page.getByTestId('setup-confirm').fill(NEW_PIN)
    await page.getByTestId('setup-submit').click()
    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // The link is single use.
    await page.goto(`/setup?t=${inviteToken}`)
    await page.getByTestId('setup-pin').fill(NEW_PIN)
    await page.getByTestId('setup-confirm').fill(NEW_PIN)
    await page.getByTestId('setup-submit').click()
    await expect(page.getByTestId('auth-error')).toBeVisible()

    // Sign out and back in on the same phone (same device id): no code needed.
    await page.goto('/app/settings')
    await page.getByTestId('sign-out').click()
    await expect(page).toHaveURL(/\/login/)
    await signIn(page, readFixture().invitedPhone.replace('+234', '0'), NEW_PIN)
    await expect(page).toHaveURL(/\/app$/)
  })

  test('a second phone needs the SMS code', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const { invitedPhone } = readFixture()
    const before = latestOtp(invitedPhone)

    await signIn(page, invitedPhone.replace('+234', '0'), NEW_PIN)
    await expect(page.getByTestId('login-code')).toBeVisible()
    await expect.poll(() => latestOtp(invitedPhone)).not.toBe(before)

    // A wrong code first, then the right one.
    const code = latestOtp(invitedPhone)!
    await page.getByTestId('login-code').fill(code === '000000' ? '000001' : '000000')
    await page.getByTestId('code-submit').click()
    await expect(page.getByTestId('auth-error')).toBeVisible()

    await page.getByTestId('login-code').fill(code)
    await page.getByTestId('code-submit').click()
    await expect(page).toHaveURL(/\/app$/)
    await context.close()
  })

  test('/app sends a signed-out visitor to sign in, then back to the page they wanted', async ({ page }) => {
    const { invitedPhone } = readFixture()
    const before = latestOtp(invitedPhone)
    await page.goto('/app/settings')
    // `next` may be percent-encoded or not; both are valid.
    await expect(page).toHaveURL(/\/login\?next=(%2F|\/)app(%2F|\/)settings$/)
    // Fill in the form we were redirected to (signIn() would reload /login and drop `next`).
    await page.getByTestId('login-phone').fill(invitedPhone.replace('+234', '0'))
    await page.getByTestId('login-pin').fill(NEW_PIN)
    await page.getByTestId('login-submit').click()
    // A new browser context is a new device, so the code step comes first.
    await expect(page.getByTestId('login-code')).toBeVisible()
    await expect.poll(() => latestOtp(invitedPhone)).not.toBe(before)
    await page.getByTestId('login-code').fill(latestOtp(invitedPhone)!)
    await page.getByTestId('code-submit').click()
    await expect(page).toHaveURL(/\/app\/settings$/)
  })
})

test('five wrong PINs lock the account, even against the right PIN', async ({ page }) => {
  for (let i = 1; i <= 4; i++) {
    await signIn(page, LOCKOUT_USER_PHONE, '999999')
    await expect(page.getByTestId('auth-error')).toContainText(/PIN/)
  }
  await signIn(page, LOCKOUT_USER_PHONE, '999999')
  // Hausa by default: "An yi kuskuren PIN da yawa. Ku sake gwadawa bayan minti 15."
  await expect(page.getByTestId('auth-error')).toContainText('15')

  await signIn(page, LOCKOUT_USER_PHONE, '123456')
  await expect(page.getByTestId('auth-error')).toContainText('15')
  await expect(page).toHaveURL(/\/login/)
})
