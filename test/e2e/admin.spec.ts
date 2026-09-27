// AC 2.6: the admin invites (here: replaces) the DG, who sets a PIN and signs in; nobody else can call the admin routes.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { AUTH_STATE_FILE, DEV_PIN, E2E_PORT, latestInviteToken, latestOtp, newOtp } from './support/env'

const ORIGIN = { Origin: `http://localhost:${E2E_PORT}` }
const ADMIN_PHONE = '+2348000000001'
const NEW_DG_PHONE = '+2348031000010'
const NEW_DG_PIN = '705319'

test.describe.serial('admin bootstrap', () => {
  test('the admin replaces the DG and the new DG sets a PIN', async ({ page, browser }) => {
    await page.goto('/login')
    await page.getByTestId('login-phone').fill('08000000001')
    await page.getByTestId('login-pin').fill(DEV_PIN)
    const before = latestOtp(ADMIN_PHONE) // the access setup signed the admin in earlier
    await page.getByTestId('login-submit').click()
    await expect(page.getByTestId('login-code')).toBeVisible()
    await expect.poll(() => newOtp(ADMIN_PHONE, before)).toMatch(/^\d{6}$/)
    await page.getByTestId('login-code').fill(latestOtp(ADMIN_PHONE)!)
    await page.getByTestId('code-submit').click()
    await expect(page).toHaveURL(/\/app$/)

    await page.getByRole('link', { name: 'Gudanarwa' }).first().click()
    await expect(page).toHaveURL(/\/app\/admin$/)
    await expect(page.getByTestId('admin-dg-name')).toHaveText('Dev DG')
    await expect(page.getByTestId('admin-dg-status')).toHaveText('Mai aiki') // "Active"

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])

    await page.getByTestId('admin-dg-open').click()
    await page.getByTestId('invite-name').fill('Aminu Bello')
    await page.getByTestId('invite-phone').fill('0803 100 0010')
    await page.getByTestId('invite-submit').click()
    await expect(page.getByTestId('admin-dg-name')).toHaveText('Aminu Bello')
    await expect(page.getByTestId('admin-dg-status')).toHaveText('An gayyata') // "Invited"
    await expect.poll(() => latestInviteToken(NEW_DG_PHONE)).toMatch(/^[\w-]{22}$/)

    const dgContext = await browser.newContext()
    const dg = await dgContext.newPage()
    await dg.goto(`/setup?t=${latestInviteToken(NEW_DG_PHONE)}`)
    await dg.getByTestId('setup-pin').fill(NEW_DG_PIN)
    await dg.getByTestId('setup-confirm').fill(NEW_DG_PIN)
    await dg.getByTestId('setup-submit').click()
    await expect(dg).toHaveURL(/\/app$/)
    const me = await (await dg.request.get('/api/auth/me')).json() as { user: { role: string } }
    expect(me.user.role).toBe('DG')
    await dgContext.close()

    await page.reload()
    await expect(page.getByTestId('admin-dg-status')).toHaveText('Mai aiki')
  })
})

test.describe('admin routes for other roles', () => {
  test.use({ storageState: AUTH_STATE_FILE }) // the Kano ward lead

  test('are refused with 403, and the page says so', async ({ page }) => {
    expect((await page.request.get('/api/admin/dg')).status()).toBe(403)
    const res = await page.request.post('/api/admin/users/dg', { headers: ORIGIN, data: { fullName: 'Not Allowed', phone: '08031000011' } })
    expect(res.status()).toBe(403)

    await page.goto('/app/admin')
    await expect(page.getByText('Mai gudanarwa ne kaɗai zai iya buɗe wannan shafi.')).toBeVisible()
  })
})
