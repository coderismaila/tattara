// Task 3.4: supporter list, search, detail, edit (PU lead) and removal request (ward lead); out of scope is 404.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { newId } from '../../shared/utils/uuid'
import { AUTH_STATE_FILE, E2E_DB_URL, E2E_PORT, PU_AUTH_STATE_FILE } from './support/env'

const ORIGIN = { Origin: `http://localhost:${E2E_PORT}` }
const NAME = 'Ladi Zzyzx'
const PHONE = '+2348031009001'
let supporterId = ''

const axeViolations = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

test.describe.serial('supporters', () => {
  test.beforeAll(async ({ playwright }) => {
    // The PU lead captures one supporter with a distinctive name through the real push route.
    const api = await playwright.request.newContext({ baseURL: `http://localhost:${E2E_PORT}`, storageState: PU_AUTH_STATE_FILE })
    supporterId = newId()
    const now = new Date().toISOString()
    const res = await api.post('/api/sync/push', {
      headers: ORIGIN,
      data: { items: [{
        id: supporterId, puCode: '19/01/01/001', fullName: NAME, phone: PHONE, supportLevel: 'strong', hasPvc: 'yes',
        consentAt: now, consentVersion: 'c1-ha', consentLanguage: 'ha', capturedAt: now,
        deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
      }] },
    })
    expect((await res.json()).results[0].result).toBe('accepted')
    await api.dispose()
  })

  test.describe('as the PU lead', () => {
    test.use({ storageState: PU_AUTH_STATE_FILE })

    test('searches by name and phone ending, opens and edits a supporter', async ({ page }) => {
      await page.goto('/app/supporters')
      await expect(page.getByTestId('supporters-list')).toBeVisible()

      await page.getByTestId('supporters-search').fill('zzyzx')
      await expect(page.getByTestId('supporters-list').locator('li')).toHaveCount(1)
      await page.getByTestId('supporters-search').fill('9001')
      await expect(page.getByTestId('supporters-list').getByText(NAME)).toBeVisible()

      await page.getByText(NAME).click()
      await expect(page).toHaveURL(new RegExp(`/app/supporters/${supporterId}$`))
      await expect(page.getByTestId('supporter-name')).toHaveText(NAME)
      await expect(page.getByTestId('supporter-details')).toContainText('+2348031009001')
      expect(await axeViolations(page)).toEqual([])

      await page.getByTestId('supporter-edit-open').click()
      await page.getByTestId('edit-name').fill('Ladi Zzyzx Garba')
      // Tap the chip as a lead would (the radio itself is visually hidden).
      await page.getByTestId('edit-support').getByText('Kaɗan', { exact: true }).click()
      await expect(page.getByRole('radio', { name: 'Kaɗan' })).toBeChecked()
      await page.getByTestId('edit-save').click()

      await expect(page.getByText('An ajiye canje-canje')).toBeVisible()
      await expect(page.getByTestId('supporter-name')).toHaveText('Ladi Zzyzx Garba')
      await expect(page.getByTestId('supporter-details')).toContainText('Kaɗan')
    })

    test('the list has no axe violations', async ({ page }) => {
      await page.goto('/app/supporters')
      await expect(page.getByTestId('supporters-list')).toBeVisible()
      expect(await axeViolations(page)).toEqual([])
    })
  })

  test.describe('as the ward lead', () => {
    test.use({ storageState: AUTH_STATE_FILE })

    test('sees the ward read-only and can request removal', async ({ page }) => {
      await page.goto('/app/supporters')
      await expect(page.getByTestId('supporters-pu')).toBeVisible()
      await page.getByTestId('supporters-search').fill('Zzyzx')
      await page.getByText('Ladi Zzyzx Garba').click()

      await expect(page.getByTestId('supporter-name')).toHaveText('Ladi Zzyzx Garba')
      await expect(page.getByTestId('supporter-edit-open')).toHaveCount(0)
      const patch = await page.request.patch(`/api/supporters/${supporterId}`, { headers: ORIGIN, data: { volunteer: true } })
      expect(patch.status()).toBe(403)

      await page.getByTestId('supporter-removal-open').click()
      await page.getByTestId('removal-reason').fill('Asked to be removed at the market')
      await page.getByTestId('removal-submit').click()
      await expect(page.getByTestId('supporter-status')).toHaveText('An nemi cirewa')
      await expect(page.getByTestId('supporter-removal-open')).toHaveCount(0)
    })

    test('a supporter from another ward is not found', async ({ page }) => {
      const sql = postgres(E2E_DB_URL, { max: 1, onnotice: () => {} })
      const [other] = await sql<{ id: string }[]>`select id from supporters where pu_code like '19/01/02/%' limit 1`
      await sql.end()

      expect((await page.request.get(`/api/supporters/${other!.id}`)).status()).toBe(404)
      expect((await page.request.get(`/api/supporters/${newId()}`)).status()).toBe(404)
      expect((await page.request.get('/api/supporters?pu=19/01/02/001')).status()).toBe(403)
      await page.goto(`/app/supporters/${other!.id}`)
      await expect(page.getByText('Ba a sami wannan magoyin baya ba, ko ba ya yankinka.')).toBeVisible()
    })
  })
})
