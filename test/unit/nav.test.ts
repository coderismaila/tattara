import { describe, expect, it } from 'vitest'
import { APP_NAV, isNavItemActive } from '../../app/utils/nav'

const home = APP_NAV.find(i => i.to === '/app')!
const settings = APP_NAV.find(i => i.to === '/app/settings')!

describe('isNavItemActive', () => {
  it('home matches only /app', () => {
    expect(isNavItemActive(home, '/app')).toBe(true)
    expect(isNavItemActive(home, '/app/')).toBe(true)
    expect(isNavItemActive(home, '/app/settings')).toBe(false)
  })

  it('other items match themselves and sub-routes, not look-alikes', () => {
    expect(isNavItemActive(settings, '/app/settings')).toBe(true)
    expect(isNavItemActive(settings, '/app/settings/device')).toBe(true)
    expect(isNavItemActive(settings, '/app/settingsx')).toBe(false)
  })

  it('every item has an i18n key and a lucide icon', () => {
    for (const item of APP_NAV) {
      expect(item.labelKey).toMatch(/^nav\./)
      expect(item.icon).toMatch(/^i-lucide-/)
    }
  })
})
