// Task 4.4 (UX §4.5): the status pill and the Sync screen. Offline captures show as waiting, then sent; a refused
// capture shows its reason and can be fixed (form filled from the phone's copy) or removed. Axe-clean with refusals.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { newId } from '../../shared/utils/uuid'
import { E2E_PORT, PU_AUTH_STATE_FILE } from './support/env'

const ORIGIN = { Origin: `http://localhost:${E2E_PORT}` }

/** A distinct run tag and phone block, so reruns against the same database don't collide. */
function runIds() {
  const n = Math.floor(Math.random() * 800_000) + 100_000
  return { tag: `Pill${n}`, phone: (i: number) => `0803${String(n * 10 + i).padStart(7, '0').slice(-7)}` }
}

const e164 = (local: string) => `+234${local.slice(1)}`

/** Use `phone` for `count` supporters on the PU lead's PU (through the push route), so the next one is refused. */
async function fillPhone(page: Page, phone: string, count: number) {
  const now = new Date().toISOString()
  const items = Array.from({ length: count }, () => ({
    id: newId(), puCode: '19/01/01/001', fullName: 'Iyali Daya', phone, sharedPhone: true, supportLevel: 'strong', hasPvc: 'yes',
    consentAt: now, consentVersion: 'c1-ha', consentLanguage: 'ha', capturedAt: now, deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
  }))
  const res = await page.request.post('/api/sync/push', { headers: ORIGIN, data: { items } })
  expect((await res.json()).results.every((r: { result: string }) => r.result === 'accepted')).toBe(true)
}

async function addSupporter(page: Page, name: string, phone: string) {
  await page.getByTestId('capture-name').fill(name)
  await page.getByTestId('capture-phone').fill(phone)
  await page.getByTestId('capture-support').getByText('Sosai', { exact: true }).click()
  await page.getByTestId('capture-pvc').getByText('E', { exact: true }).click()
  await page.getByRole('checkbox', { name: /Ya amince/ }).click()
  await page.getByTestId('capture-submit').click()
  await expect(page.getByTestId('capture-name')).toHaveValue('')
}

/** Open the Sync screen, then Add supporter, through the app (so both pages' code is loaded before going offline). */
async function openCapture(page: Page) {
  await page.goto('/app/sync')
  await expect(page.getByTestId('sync-send-now')).toBeVisible()
  await page.getByRole('navigation', { name: 'Babban kewayawa' }).last().getByRole('link', { name: 'Ƙara magoyi' }).click()
  await expect(page.getByTestId('capture-name')).toBeEnabled()
}

test.describe('sync screen and status pill (PU lead)', () => {
  test.use({ storageState: PU_AUTH_STATE_FILE })

  test('offline captures wait on the phone, then show as sent', async ({ page, context }) => {
    const { tag, phone } = runIds()
    await openCapture(page)

    await context.setOffline(true)
    await addSupporter(page, `${tag} A`, phone(1))
    await addSupporter(page, `${tag} B`, phone(2))
    const pill = page.getByTestId('sync-pill')
    await expect(page.getByTestId('sync-pill-label')).toHaveText('An adana a waya · 2 na jiran aika')
    await expect(pill).toHaveAttribute('data-tone', 'neutral')

    await pill.click()
    await expect(page).toHaveURL(/\/app\/sync$/)
    await expect(page.getByTestId('sync-summary')).toContainText('ba ta da intanet')
    await expect(page.getByTestId('sync-pending-item')).toHaveText([new RegExp(`${tag} A`), new RegExp(`${tag} B`)])
    await expect(page.getByTestId('sync-send-now')).toBeDisabled()

    // Back online the engine sends them by itself; the screen and the pill follow.
    await context.setOffline(false)
    await expect(page.getByTestId('sync-pending-item')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByTestId('sync-sent-item').filter({ hasText: tag })).toHaveCount(2)
    await expect(page.getByTestId('sync-pill-label')).toHaveText('An aika duka')
    await expect(pill).toHaveAttribute('data-tone', 'success')
    await expect(page.getByTestId('sync-last')).toContainText('Aikawa ta ƙarshe')

    await page.getByTestId('sync-send-now').click()
    await expect(page.getByText('An aika komai.', { exact: true })).toBeVisible()
  })

  test('a refused capture states why, and can be fixed or removed', async ({ page, context }) => {
    const { tag, phone } = runIds()
    const full = phone(1)
    await fillPhone(page, e164(full), 3)
    await openCapture(page)

    // Captured offline, so the server sees them only later: both are refused (4th and 5th use of the number).
    await context.setOffline(true)
    await addSupporter(page, `${tag} Fix`, full)
    await addSupporter(page, `${tag} Drop`, full)
    await context.setOffline(false)
    await expect(page.getByTestId('sync-pill-label')).toHaveText('2 ba a karɓa ba', { timeout: 30_000 })
    await expect(page.getByTestId('sync-pill')).toHaveAttribute('data-tone', 'warning')

    await page.getByTestId('sync-pill').click()
    const items = page.getByTestId('sync-rejected-item')
    await expect(items).toHaveCount(2)
    await expect(items.first().getByTestId('sync-rejected-reason')).toContainText('Magoya baya 3 sun riga sun yi amfani da wannan lambar')
    // Axe once the save toasts have closed: Nuxt UI's toaster adds aria-hidden focus guards while a toast is open.
    await expect(page.locator('[role="region"] li')).toHaveCount(0, { timeout: 15_000 })
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])

    // Fix: the form comes back filled; consent is asked again; a corrected number saves.
    await items.filter({ hasText: `${tag} Fix` }).getByTestId('sync-fix').click()
    await expect(page.getByTestId('capture-fixing')).toBeVisible()
    await expect(page.getByTestId('capture-name')).toHaveValue(`${tag} Fix`)
    await expect(page.getByRole('radio', { name: 'Sosai' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: /Ya amince/ })).not.toBeChecked()
    await page.getByTestId('capture-phone').fill(phone(2))
    await page.getByRole('checkbox', { name: /Ya amince/ }).click()
    await page.getByTestId('capture-submit').click()
    await expect(page.getByText('An ajiye', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/app\/capture$/)

    // Remove: the other one leaves the phone after a confirmation.
    await page.getByTestId('sync-pill').click()
    await expect(items).toHaveCount(1)
    await items.getByTestId('sync-remove').click()
    await page.getByTestId('sync-remove-confirm').click()
    await expect(page.getByTestId('sync-rejected')).toHaveCount(0)
    await expect(page.getByTestId('sync-sent-item').filter({ hasText: `${tag} Fix` })).toHaveCount(1)
    await expect(page.getByTestId('sync-pill-label')).toHaveText('An aika duka')
  })
})
