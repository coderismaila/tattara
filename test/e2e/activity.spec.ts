// Task 6.5: the ward lead opens Activity from Home, sees the ward's PUs ranked (last 7 days, then by progress), and
// finds a PU lead who never captured and one who never set up, each linking to Team. Its own two leads are inserted
// here (other specs activate the setup's invited lead), and it asks for the 7-day window, which nothing else caches.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { users } from '../../server/db/schema'
import { createDb } from '../../server/db/client'
import { AUTH_STATE_FILE, E2E_DB_URL } from './support/env'

test.use({ storageState: AUTH_STATE_FILE })

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(x => x.target.join(' ')).join(', ')}`)).toEqual([])
}

test.beforeAll(async () => {
  const { db, client } = createDb(E2E_DB_URL, { max: 1 })
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)
  await db.insert(users).values([
    { fullName: 'Quiet Lead', phone: '+2348031007007', role: 'PU_LEAD', unitCode: '19/01/01/007', unitLevel: 'pu', pinHash: 'x', status: 'active', createdAt: daysAgo(20) },
    { fullName: 'Pending Lead', phone: '+2348031007006', role: 'PU_LEAD', unitCode: '19/01/01/006', unitLevel: 'pu', status: 'invited', createdAt: daysAgo(6) },
  ]).onConflictDoNothing()
  await client.end()
})

test('ward lead: leaderboard of the ward’s PUs, then the leads who need a nudge', async ({ page }) => {
  await page.goto('/app')
  await page.getByTestId('home-activity').click()
  await expect(page).toHaveURL(/\/app\/activity/)

  await page.getByTestId('activity-tab-top').click()
  const rows = page.locator('[data-testid^="activity-row-19/01/01/"]')
  await expect(rows).toHaveCount(10)
  await expect(rows.first().getByTestId('activity-row-value')).toContainText('a kwanaki 7')
  await axe(page)
  await page.getByTestId('activity-metric-progress').click()
  await expect(page.getByTestId('activity-metric-progress')).toHaveAttribute('aria-pressed', 'true')
  await expect(rows).toHaveCount(10)

  await page.getByTestId('activity-tab-inactive').click()
  await page.getByTestId('activity-days-7').click()
  const quiet = page.getByTestId('activity-lead-19/01/01/007')
  await expect(quiet).toContainText('Quiet Lead')
  await expect(quiet).toContainText('Bai taɓa ƙara magoyi ba (kwanaki 20')
  await expect(page.getByTestId('activity-invited-19/01/01/006')).toContainText('Pending Lead')
  await expect(page.locator('body')).not.toContainText('+234')
  await axe(page)

  await quiet.getByRole('link').click()
  await expect(page).toHaveURL(/\/app\/team\?unit=19-01-01/)
})
