// Task 6.3: the map. Ward lead: canvas, legend, the PUs listed, a unit's sheet linking to its dashboard. LGA lead:
// drill from a ward in the list into its PU points. MapLibre is never downloaded by the capture page or the PU home.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { AUTH_STATE_FILE, LGA_AUTH_STATE_FILE, PU_AUTH_STATE_FILE, ROOT } from './support/env'

/** Built chunks that contain MapLibre or the map component (names are hashed). */
function mapChunks(): string[] {
  const dir = join(ROOT, '.output/public/_nuxt')
  const hits = readdirSync(dir).filter(f => f.endsWith('.js') && /maplibregl-canvas|data-testid="map-canvas"|"map-canvas"/.test(readFileSync(join(dir, f), 'utf8')))
  expect(hits.length, 'map chunks found in the build').toBeGreaterThan(0)
  return hits
}

function scripts(page: Page) {
  const urls: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') urls.push(r.url())
  })
  return urls
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('[data-testid="map-canvas"]') // the WebGL canvas and MapLibre's own controls; the table is the alternative
    .analyze()
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(x => x.target.join(' ')).join(', ')}`)).toEqual([])
}

test.describe('map (ward lead)', () => {
  test.use({ storageState: AUTH_STATE_FILE })

  test('draws the ward’s PUs with a legend; a PU opens its sheet and dashboard', async ({ page }) => {
    const loaded = scripts(page)
    await page.goto('/app/map')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 20_000 })
    // Something is actually drawn: needs MapLibre's worker (a canvas alone proved nothing, see ADR-047).
    await expect.poll(async () => Number(await page.getByTestId('map-canvas').getAttribute('data-rendered')), { timeout: 20_000 }).toBeGreaterThan(0)
    await expect(page.getByTestId('map-legend')).toContainText('Kai wa ga masu rajista')
    await page.getByTestId('map-list-toggle').click() // phones: the list sits behind a toggle
    await expect(page.locator('[data-testid^="home-child-19/01/01/"]')).toHaveCount(10)
    expect(loaded.some(u => mapChunks().some(c => u.endsWith(`/${c}`)))).toBe(true)
    await axe(page)

    await page.getByTestId('home-child-19/01/01/001').getByRole('button').click()
    await expect(page.getByTestId('map-sheet')).toBeVisible()
    await expect(page.getByTestId('map-zoom-in')).toHaveCount(0) // a PU is the bottom level
    await expect(page.getByTestId('map-open-dashboard')).toHaveAttribute('href', '/app/units/19-01-01-001')
    await page.getByTestId('map-open-dashboard').click()
    await expect(page.getByTestId('home-summary-supporters')).toHaveText(/^[\d,]+$/)
  })
})

test.describe('map (LGA lead)', () => {
  test.use({ storageState: LGA_AUTH_STATE_FILE })

  test('drills from a ward in the list down to its PU points', async ({ page }) => {
    await page.goto('/app/map')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('map-metric-supporters').click()
    await expect(page.getByTestId('map-legend')).toContainText('Magoya baya')
    await page.getByTestId('map-list-toggle').click()
    await page.getByTestId('home-child-19/01/01').getByRole('button').click()
    await page.getByTestId('map-zoom-in').click()
    await expect(page.locator('[data-testid^="home-child-19/01/01/"]')).toHaveCount(10)
    await expect.poll(async () => Number(await page.getByTestId('map-canvas').getAttribute('data-rendered')), { timeout: 20_000 }).toBeGreaterThan(0)
    await expect(page.getByTestId('map-breadcrumb').getByRole('listitem')).toHaveCount(2) // LGA › ward
    await page.getByTestId('map-breadcrumb').getByRole('button').click() // back up to the LGA
    await expect(page.getByTestId('home-child-19/01/01')).toBeVisible()
  })
})

test.describe('map code stays off the field screens (PU lead)', () => {
  test.use({ storageState: PU_AUTH_STATE_FILE })

  test('capture and home never download MapLibre', async ({ page }) => {
    const loaded = scripts(page)
    await page.goto('/app')
    await expect(page.getByTestId('home-add')).toBeVisible()
    await page.goto('/app/capture')
    await expect(page.getByTestId('capture-name')).toBeEnabled()
    const chunks = mapChunks()
    expect(loaded.filter(u => chunks.some(c => u.endsWith(`/${c}`)))).toEqual([])
  })
})
