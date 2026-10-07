// AC 4.3: capture 20 supporters offline → go online → all 20 accepted exactly once; killing the app mid-sync causes no
// duplicates. The engine runs on its own (the `online` event, app start); nothing here presses a button.
import { expect, test, type Page } from '@playwright/test'
import { PU_AUTH_STATE_FILE } from './support/env'

/** Counts in the phone's IndexedDB (the Dexie `tattara` database), read with the raw API. */
async function localCounts(page: Page) {
  return page.evaluate(() => new Promise<{ outbox: number, pending: number, synced: number, pulled: number }>((resolve, reject) => {
    const open = indexedDB.open('tattara')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction(['outbox', 'supporters'], 'readonly')
      const outbox = tx.objectStore('outbox').count()
      const all = tx.objectStore('supporters').getAll()
      tx.oncomplete = () => {
        const rows = all.result as { syncStatus: string, deviceId?: string }[]
        resolve({
          outbox: outbox.result,
          pending: rows.filter(r => r.syncStatus === 'pending').length,
          synced: rows.filter(r => r.syncStatus === 'synced').length,
          pulled: rows.filter(r => r.syncStatus === 'synced' && !r.deviceId).length,
        })
        open.result.close()
      }
    }
  }))
}

/** Supporters on the server whose name contains `tag` (the PU lead's own PU), with their ids. */
async function onServer(page: Page, tag: string): Promise<string[]> {
  const res = await page.request.get(`/api/supporters?q=${encodeURIComponent(tag)}&limit=200`)
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { items: { id: string }[] }).items.map(i => i.id)
}

/** A distinct run tag and phone block, so reruns against the same database don't collide. */
function runIds() {
  const n = Math.floor(Math.random() * 800_000) + 100_000
  return { tag: `Sync${n}`, phone: (i: number) => `0803${String(n * 10 + i).padStart(7, '0').slice(-7)}` }
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

test.describe('sync engine (PU lead)', () => {
  test.use({ storageState: PU_AUTH_STATE_FILE })

  test('20 captures made offline are all accepted exactly once when the phone is back online', async ({ page, context }) => {
    test.setTimeout(180_000)
    const { tag, phone } = runIds()
    await page.goto('/app/capture')
    await expect(page.getByTestId('capture-name')).toBeEnabled()

    await context.setOffline(true)
    try {
      for (let i = 0; i < 20; i++) await addSupporter(page, `${tag} ${i}`, phone(i))
      expect(await localCounts(page)).toMatchObject({ outbox: 20, pending: 20 })
    }
    finally {
      await context.setOffline(false)
    }

    // The `online` event starts a run: batches go out, answers come back, then the pull.
    await expect.poll(async () => (await localCounts(page)).outbox, { timeout: 30_000 }).toBe(0)
    const ids = await onServer(page, tag)
    expect(ids).toHaveLength(20)
    expect(new Set(ids).size).toBe(20)
    // The pull brought the rest of the PU (records captured elsewhere) onto the phone.
    await expect.poll(async () => (await localCounts(page)).pulled, { timeout: 30_000 }).toBeGreaterThan(0)
    expect((await localCounts(page)).pending).toBe(0)
  })

  test.describe('app killed mid-sync', () => {
    // Without the service worker, Background Sync can't send the batch behind the test's back.
    test.use({ serviceWorkers: 'block' })

    test('the server saved the batch but the answer never arrived: the next start sends it again, no duplicates', async ({ page, context }) => {
      test.setTimeout(120_000)
      const { tag, phone } = runIds()
      await page.goto('/app/capture')
      await expect(page.getByTestId('capture-name')).toBeEnabled()

      await context.setOffline(true)
      for (let i = 0; i < 5; i++) await addSupporter(page, `${tag} ${i}`, phone(i))

      // Let the push reach the server, then cut the connection before the answer gets back.
      let delivered!: () => void
      const reachedServer = new Promise<void>(r => (delivered = r))
      await context.route('**/api/sync/push', async (route) => {
        await route.fetch()
        await route.abort('connectionreset')
        delivered()
      })
      await context.setOffline(false)
      await reachedServer
      expect(await onServer(page, tag)).toHaveLength(5)
      expect((await localCounts(page)).outbox).toBe(5) // no answer: still queued

      // Kill the app, then start it again with a working connection.
      await page.close()
      await context.unrouteAll({ behavior: 'wait' })
      const again = await context.newPage()
      await again.goto('/app/capture')
      await expect.poll(async () => (await localCounts(again)).outbox, { timeout: 30_000 }).toBe(0)
      expect((await localCounts(again)).pending).toBe(0)
      const ids = await onServer(again, tag)
      expect(ids).toHaveLength(5)
      expect(new Set(ids).size).toBe(5)
    })
  })
})
