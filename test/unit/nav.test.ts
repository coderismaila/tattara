import { describe, expect, it } from 'vitest'
import { APP_NAV, TEAM_ROLES, isNavItemActive, navItemsFor } from '../../app/utils/nav'
import { canManageTeam } from '../../server/services/team'
import { ROLES } from '../../shared/constants/roles'

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

describe('navItemsFor', () => {
  it('shows Team only to leads who manage a team, Admin only to the admin', () => {
    expect(navItemsFor('WARD_LEAD').map(i => i.to)).toEqual(['/app', '/app/supporters', '/app/team', '/app/settings'])
    expect(navItemsFor('PU_LEAD').map(i => i.to)).toEqual(['/app', '/app/capture', '/app/supporters', '/app/sync', '/app/settings'])
    expect(navItemsFor('ADMIN').map(i => i.to)).toEqual(['/app', '/app/admin', '/app/settings'])
    expect(navItemsFor('DG').map(i => i.to)).toEqual(['/app', '/app/team', '/app/settings'])
    expect(navItemsFor(undefined).map(i => i.to)).toEqual(['/app', '/app/settings'])
  })

  it('TEAM_ROLES matches the server rule exactly', () => {
    expect(ROLES.filter(canManageTeam)).toEqual([...TEAM_ROLES])
  })
})
