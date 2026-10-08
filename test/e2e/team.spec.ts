// AC 2.5: a ward lead cannot invite into another ward (403); deactivation revokes the session on the next request.
// 4.5: and the deactivated lead's phone deletes its local data on its next contact with the server.
import { expect, test } from '@playwright/test'
import { AUTH_STATE_FILE, E2E_PORT, latestInviteToken } from './support/env'
import { localMetaKeys } from './support/offline'

// The signed-in Kano ward lead (19/01/01), saved by auth.setup.ts.
test.use({ storageState: AUTH_STATE_FILE })

const ORIGIN = { Origin: `http://localhost:${E2E_PORT}` }
const UNIT = '19/01/01/005' // untouched by other specs
const LEAD_PHONE = '+2348031000005'
const LEAD_PIN = '705312'

test.describe.serial('team management', () => {
  test('the ward lead sees the PUs of their ward and invites a lead', async ({ page }) => {
    await page.goto('/app/team')
    await expect(page.getByTestId('team-list').locator('li')).toHaveCount(10)
    await expect(page.getByTestId(`team-status-${UNIT}`)).toHaveText('Babu') // "None"

    await page.getByTestId(`team-invite-${UNIT}`).click()
    await page.getByTestId('invite-name').fill('Musa Garba')
    await page.getByTestId('invite-phone').fill('0803 100 0005')
    await page.getByTestId('invite-submit').click()

    await expect(page.getByTestId(`team-status-${UNIT}`)).toHaveText('An gayyata') // "Invited"
    await expect.poll(() => latestInviteToken(LEAD_PHONE)).toMatch(/^[\w-]{22}$/)
  })

  test('inviting into another ward is refused with 403', async ({ page }) => {
    const res = await page.request.post('/api/team/invite', {
      headers: ORIGIN,
      data: { unitCode: '20/01/01/002', fullName: 'Not Mine', phone: '08031000006' },
    })
    expect(res.status()).toBe(403)

    // Nor two levels down, nor the ward itself.
    for (const unitCode of ['19/01/02/001', '19/01/01']) {
      const r = await page.request.post('/api/team/invite', { headers: ORIGIN, data: { unitCode, fullName: 'Not Mine', phone: '08031000007' } })
      expect(r.status(), unitCode).toBe(403)
    }
  })

  test('deactivation signs the lead out on their next request', async ({ page, browser }) => {
    // The invited lead accepts on their own phone.
    const leadContext = await browser.newContext()
    const lead = await leadContext.newPage()
    await lead.goto(`/setup?t=${latestInviteToken(LEAD_PHONE)}`)
    await lead.getByTestId('setup-pin').fill(LEAD_PIN)
    await lead.getByTestId('setup-confirm').fill(LEAD_PIN)
    await lead.getByTestId('setup-submit').click()
    await expect(lead).toHaveURL(/\/app$/)
    expect((await lead.request.get('/api/auth/me')).status()).toBe(200)
    expect(await localMetaKeys(lead)).toEqual(expect.arrayContaining(['session', 'pinVerifier']))

    // The ward lead deactivates them.
    await page.goto('/app/team')
    await expect(page.getByTestId(`team-status-${UNIT}`)).toHaveText('Mai aiki') // "Active"
    await page.getByTestId(`team-deactivate-${UNIT}`).click()
    await page.getByTestId('deactivate-reason').fill('Moved to another ward')
    await page.getByTestId('deactivate-submit').click()
    await expect(page.getByTestId(`team-status-${UNIT}`)).toHaveText('Babu')

    // Their very next request is refused, and they cannot sign in again.
    expect((await lead.request.get('/api/auth/me')).status()).toBe(401)
    // Even after that first 401, the app learns the session was revoked and wipes the phone.
    await lead.reload()
    await expect(lead).toHaveURL(/\/login/)
    await expect.poll(() => localMetaKeys(lead)).toEqual([])
    const login = await lead.request.post('/api/auth/login', {
      headers: ORIGIN,
      data: { phone: LEAD_PHONE, pin: LEAD_PIN, deviceId: '0190f3a2-1c4b-7d8e-9f0a-1b2c3d4e5f62' },
    })
    expect(login.status()).toBe(401)
    await leadContext.close()
  })
})

// 5.5: each PU shows its quality score (number + word) and what it is made of. The dev seed computes the scores.
test('the ward lead sees the quality score of each PU and why', async ({ page }) => {
  await page.goto('/app/team')
  const quality = page.getByTestId('team-quality-19/01/01/001')
  await expect(quality.getByTestId('team-quality-score-19/01/01/001')).toHaveText(/^\d{1,3} · (Mai kyau|Matsakaici|Ƙasa)$/)
  await quality.getByText('Dalilin wannan maki').click()
  await expect(quality.getByText('Magoya baya (kwana 90)')).toBeVisible()
  await expect(quality).toContainText('ana sabuntawa kowane dare')
})

test.describe('team access', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('team routes need a session', async ({ request }) => {
    expect((await request.get('/api/team')).status()).toBe(401)
  })
})
