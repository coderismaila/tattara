// Task 4.1 AC: installable (valid manifest, PNG icons, service worker controlling the page) and the app shell loads in
// airplane mode after the first visit; the API is never cached.
import { expect, test } from '@playwright/test'
import { AUTH_STATE_FILE, PU_AUTH_STATE_FILE } from './support/env'

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

test('the manifest makes the app installable', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()

  const manifest = await (await request.get(href!)).json()
  expect(manifest).toMatchObject({ name: 'Tattara', short_name: 'Tattara', start_url: '/app', display: 'standalone', lang: 'ha' })
  const icons = manifest.icons as { src: string, sizes: string, type: string, purpose?: string }[]
  for (const size of ['192x192', '512x512']) {
    expect(icons.some(i => i.sizes === size && i.type === 'image/png' && i.purpose !== 'maskable'), size).toBe(true)
  }
  expect(icons.some(i => i.purpose === 'maskable')).toBe(true)

  for (const icon of icons) {
    const res = await request.get(icon.src)
    expect(res.status(), icon.src).toBe(200)
    const { width, height } = pngSize(await res.body())
    expect(`${width}x${height}`, icon.src).toBe(icon.sizes)
  }
})

test.describe('offline shell', () => {
  test.use({ storageState: AUTH_STATE_FILE }) // Kano ward lead

  test('after a first visit, /app opens with no network', async ({ page, context }) => {
    await page.goto('/app')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // The service worker is installed, active, and has the shell cached.
    await page.evaluate(() => navigator.serviceWorker.ready)
    await expect.poll(() => page.evaluate(async () => !!(await (await caches.open('tattara-shell')).match('/app')))).toBe(true)
    await page.reload() // now controlled by the service worker
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

    await context.setOffline(true)
    try {
      await page.goto('/app/team') // any /app page: served from the shell
      await expect(page.locator('header')).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Babban kewayawa' }).first()).toBeVisible()
      await expect(page).toHaveURL(/\/app\/team$/) // not bounced to /login
    }
    finally {
      await context.setOffline(false)
    }
  })
})

test.describe('no supporter data in the service worker cache', () => {
  test.use({ storageState: PU_AUTH_STATE_FILE })

  test('browsing supporters leaves no /api response in any cache', async ({ page }) => {
    await page.goto('/app/supporters')
    await expect(page.getByTestId('supporters-list')).toBeVisible()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect(page.getByTestId('supporters-list')).toBeVisible()

    const cached = await page.evaluate(async () => {
      const urls: string[] = []
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname)
      }
      return urls
    })
    expect(cached.length).toBeGreaterThan(0) // the app itself is precached
    expect(cached.filter(u => u.startsWith('/api'))).toEqual([])
  })
})
