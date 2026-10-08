// Task 5.3: the ward lead's call-back list. A call due today shows the supporter with a tap-to-call link; saving
// "confirmed" moves it to Done and the supporter becomes callback_verified. Axe-clean with an open call.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { createDb } from '../../server/db/client'
import { callbacks, users } from '../../server/db/schema'
import { createSupporter } from '../../server/services/supporters'
import { lagosDate } from '../../shared/utils/lagos-date'
import { newId } from '../../shared/utils/uuid'
import { AUTH_STATE_FILE, E2E_DB_URL } from './support/env'

/** A supporter on the Kano PU and a call-back for it due today (what the 05:00 sample task would draw). */
async function seedCall(fullName: string, phone: string) {
  const { db, client } = createDb(E2E_DB_URL, { max: 1 })
  try {
    const [lead] = await db.select().from(users).where(eq(users.phone, '+2348000000104'))
    const now = new Date().toISOString()
    const r = await createSupporter(db, { id: lead!.id, role: lead!.role, unitCode: lead!.unitCode }, {
      id: newId(), puCode: '19/01/01/001', fullName, phone, sharedPhone: false, address: null, gender: null, ageBand: null,
      supportLevel: 'strong', hasPvc: 'yes', volunteer: false, consentAt: now, consentVersion: 'c1-ha', consentLanguage: 'ha',
      gps: null, capturedAt: now, deviceId: 'e2e-review',
    })
    if (r.kind !== 'accepted') throw new Error(r.kind)
    await db.insert(callbacks).values({ supporterId: r.supporter.id, wardCode: '19/01/01', dueDate: lagosDate() })
    return r.supporter.id
  }
  finally {
    await client.end()
  }
}

test.describe('call-backs (ward lead)', () => {
  test.use({ storageState: AUTH_STATE_FILE })

  test('a call due today is made, saved as confirmed, and verifies the supporter', async ({ page }) => {
    const n = Math.floor(Math.random() * 90_000) + 10_000
    const name = `Callback ${n}`
    const phone = `+2348031${String(n).padStart(6, '0')}`
    const supporterId = await seedCall(name, phone)

    await page.goto('/app/review')
    const card = page.getByTestId('callback-item').filter({ hasText: name })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('callback-call')).toHaveAttribute('href', `tel:${phone}`)

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(x => x.target.join(' ')).join(', ')}`)).toEqual([])

    // Save stays off until an outcome is chosen; a phone number in the note is refused.
    await expect(card.getByTestId('callback-save')).toBeDisabled()
    await card.getByTestId('callback-outcome').getByText('Ya tabbatar', { exact: true }).click()
    await card.getByTestId('callback-notes').fill('Ya ce a kira 0803 123 4567')
    await card.getByTestId('callback-save').click()
    await expect(card.getByTestId('callback-error')).toHaveText('Cire lambar waya daga bayanin.')
    await card.getByTestId('callback-notes').fill('Yana goyon baya sosai')
    await card.getByTestId('callback-save').click()

    await expect(page.getByText('An ajiye kiran', { exact: true })).toBeVisible()
    await expect(page.getByTestId('callback-done').filter({ hasText: name })).toContainText('Ya tabbatar')
    await expect(card).toHaveCount(0)

    const res = await page.request.get(`/api/supporters/${supporterId}`)
    expect((await res.json()).supporter.verification).toBe('callback_verified')
  })
})
