// Usage: pnpm icons — renders the PWA icons (public/icons/*.png) from the SVG below with Playwright's Chromium.
// Chrome needs 192 and 512 px PNGs (plus a maskable one) to offer "Install app". Re-run after changing the design.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const INDIGO = '#1F3A68' // UX §3 indigo-dye
const MILLET = '#E9D8A6'
const LATERITE = '#B5552B'

/** A "T" built from shapes (no font needed), on indigo. Maskable icons get full bleed and a 70% safe zone. */
function svg(maskable: boolean): string {
  const mark = `
    <rect x="24" y="22" width="52" height="13" rx="3" fill="${MILLET}"/>
    <rect x="43" y="22" width="14" height="52" rx="3" fill="${MILLET}"/>
    <rect x="31" y="80" width="38" height="5" rx="2.5" fill="${LATERITE}"/>`
  return maskable
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${INDIGO}"/><g transform="translate(15 15) scale(0.7)">${mark}</g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${INDIGO}"/>${mark}</svg>`
}

const OUT = new URL('../public/icons/', import.meta.url)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const { name, size, maskable } of [
    { name: 'icon-192.png', size: 192, maskable: false },
    { name: 'icon-512.png', size: 512, maskable: false },
    { name: 'maskable-512.png', size: 512, maskable: true },
    { name: 'apple-touch-icon.png', size: 180, maskable: true },
  ]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(maskable).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
    await page.screenshot({ path: fileURLToPath(new URL(name, OUT)), omitBackground: true })
    console.log(`public/icons/${name} (${size}×${size})`)
  }
}
finally {
  await browser.close()
}
