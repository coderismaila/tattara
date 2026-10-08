// Task 5.4: flag review. The ward lead sees the supporter in full and dismisses a flag with a note (a phone number in
// the note is refused); the LGA lead sees the same kind of flag masked. Axe-clean with flags listed.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { createDb } from '../../server/db/client'
import { flags, users } from '../../server/db/schema'
import { refreshFlaggedOpen } from '../../server/services/flags'
import { createSupporter } from '../../server/services/supporters'
import { newId } from '../../shared/utils/uuid'
import { AUTH_STATE_FILE, E2E_DB_URL, LGA_AUTH_STATE_FILE } from './support/env'

/** A supporter on the Kano PU with an open gps_far flag (as the flag engine raises it). */
async function seedFlag(fullName: string, phone: string) {
  const { db, client } = createDb(E2E_DB_URL, { max: 1 })
  try {
    const [lead] = await db.select().from(users).where(eq(users.phone, '+2348000000104'))
    const now = new Date().toISOString()
    const r = await createSupporter(db, { id: lead!.id, role: lead!.role, unitCode: lead!.unitCode }, {
      id: newId(), puCode: '19/01/01/001', fullName, phone, sharedPhone: false, address: null, gender: null, ageBand: null,
      supportLevel: 'strong', hasPvc: 'yes', volunteer: false, consentAt: now, consentVersion: 'c1-ha', consentLanguage: 'ha',
      gps: null, capturedAt: now, deviceId: 'e2e-flags',
    })
    if (r.kind !== 'accepted') throw new Error(r.kind)
    await db.insert(flags).values({ supporterId: r.supporter.id, puCode: '19/01/01/001', type: 'gps_far', details: { distanceM: 6234, thresholdM: 3000, accuracyM: 12, puLocationEstimated: false } })
    await refreshFlaggedOpen(db, ['19/01/01/001'])
  }
  finally {
    await client.end()
  }
}

const ids = () => {
  const n = Math.floor(Math.random() * 90_000) + 10_000
  return { name: `Tuta Gwaji${n}`, phone: `+2348032${String(n).padStart(6, '0')}` }
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(x => x.target.join(' ')).join(', ')}`)).toEqual([])
}

test.describe('flag review', () => {
  test.describe('as the ward lead', () => {
    test.use({ storageState: AUTH_STATE_FILE })

    test('sees the supporter in full and dismisses the flag with a note', async ({ page }) => {
      const { name, phone } = ids()
      await seedFlag(name, phone)
      await page.goto('/app/review')
      const card = page.getByTestId('flag-item').filter({ hasText: name })
      await expect(card.getByTestId('flag-evidence')).toHaveText('An ƙara shi kilomita 6.2 daga rumfa (iyaka kilomita 3).')
      await expect(card.getByTestId('flag-subject')).toHaveText(`Magoyi: ${name}, ${phone}`)
      await axe(page)

      await card.getByTestId('flag-dismiss').click()
      await page.getByTestId('flag-note').fill('Kira 0803 123 4567')
      await page.getByTestId('flag-submit').click()
      await expect(page.getByTestId('flag-error')).toHaveText('Cire lambar waya daga bayanin.')
      await page.getByTestId('flag-note').fill('Taron siyasa ne')
      await page.getByTestId('flag-submit').click()
      await expect(page.getByText('An yi watsi da alama', { exact: true })).toBeVisible()
      await expect(card).toHaveCount(0)

      await page.getByTestId('flag-status').getByText('An duba', { exact: true }).click()
      await expect(page.getByTestId('flag-item').filter({ hasText: name }).getByTestId('flag-review')).toContainText('An yi watsi')
      await expect(page.getByTestId('flag-item').filter({ hasText: name }).getByTestId('flag-review')).toContainText('Taron siyasa ne')
    })
  })

  test.describe('as the LGA lead', () => {
    test.use({ storageState: LGA_AUTH_STATE_FILE })

    test('sees supporters masked, never names or full numbers', async ({ page }) => {
      const { name, phone } = ids()
      await seedFlag(name, phone)
      await page.goto('/app/review')
      await page.getByTestId('flag-type-gps_far').click()
      await expect(page.getByTestId('flag-item').first()).toBeVisible()
      await expect(page.getByText(name)).toHaveCount(0)
      await expect(page.getByText(phone)).toHaveCount(0)
      const initials = `Magoyi: T. G., +234 80* *** ${phone.slice(-4)}`
      await expect(page.getByTestId('flag-subject').filter({ hasText: initials })).toHaveCount(1)
      await expect(page.getByTestId('callback-progress')).toHaveCount(0) // call-backs are the ward lead's
      await axe(page)
    })
  })
})
