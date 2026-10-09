// Task 6.4: targets. LGA lead: opens Targets from Home, sets a ward's target, splits their own target across the wards
// (preview, then save) and sees it fully shared out. Ward lead: sets a PU's target and splits the ward's across its
// PUs. Serial: both change the same Kano chain's targets.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { AUTH_STATE_FILE, LGA_AUTH_STATE_FILE } from './support/env'

test.describe.configure({ mode: 'serial' })

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(x => x.target.join(' ')).join(', ')}`)).toEqual([])
}

/** Set one unit's target through its dialog. */
async function setTarget(page: Page, code: string, value: string) {
  const row = page.getByTestId(`target-row-${code}`)
  await row.getByTestId('target-row-edit').click()
  await page.getByTestId('target-input').fill(value)
  await page.getByTestId('target-save').click()
  await expect(row.getByTestId('target-row-value')).toHaveText(Number(value).toLocaleString('en-US'))
}

/**
 * Preview the split, save it, and check it shares out the whole target. Not row by row against the preview: other specs
 * record registered voters in the same ward meanwhile, which changes the weights between preview and save.
 */
async function split(page: Page) {
  await page.getByTestId('targets-split').click()
  await expect(page.getByTestId('split-basis')).toBeVisible()
  await expect(page.locator('[data-testid^="split-row-"]').first()).toBeVisible()
  await axe(page)
  await page.getByTestId('split-confirm').click()
  await expect(page.getByTestId('split-confirm')).toBeHidden()
  await expect(page.getByTestId('targets-allocation')).toHaveText('An raba dukan burinka.')
  for (const value of await page.getByTestId('target-row-value').allTextContents()) expect(value).toMatch(/^[\d,]+$/)
}

test.describe('targets (LGA lead)', () => {
  test.use({ storageState: LGA_AUTH_STATE_FILE })

  test('sets a ward target, then splits the LGA target across its wards', async ({ page }) => {
    await page.goto('/app')
    await page.getByTestId('home-targets').click()
    await expect(page).toHaveURL(/\/app\/targets$/)
    await expect(page.getByTestId('targets-own-value')).toHaveText(/^[\d,]+$/) // the dev seed gives the LGA a target
    await axe(page)

    await setTarget(page, '19/01/02', '1234')
    await split(page)
  })
})

test.describe('targets (ward lead)', () => {
  test.use({ storageState: AUTH_STATE_FILE })

  test('sets a PU target, then splits the ward target across its PUs', async ({ page }) => {
    await page.goto('/app/targets')
    await expect(page.locator('[data-testid^="target-row-19/01/01/"]')).toHaveCount(10)
    await setTarget(page, '19/01/01/001', '50')
    await split(page)
  })
})
