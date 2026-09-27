// Signed-in navigation. Add an entry when its page lands (later: capture, supporters, map, sync).
import type { Role } from '~~/shared/constants/roles'

export interface NavItem {
  to: string
  labelKey: string
  icon: string
  /** Roles that see this item; omitted = everyone. The server enforces access regardless. */
  roles?: readonly Role[]
}

/** Leads who manage a team (server/services/team.ts canManageTeam). */
export const TEAM_ROLES: readonly Role[] = ['DG', 'STATE_LEAD', 'LGA_LEAD', 'WARD_LEAD']

export const APP_NAV: readonly NavItem[] = [
  { to: '/app', labelKey: 'nav.home', icon: 'i-lucide-house' },
  { to: '/app/capture', labelKey: 'nav.capture', icon: 'i-lucide-user-plus', roles: ['PU_LEAD'] },
  { to: '/app/team', labelKey: 'nav.team', icon: 'i-lucide-users', roles: TEAM_ROLES },
  { to: '/app/admin', labelKey: 'nav.admin', icon: 'i-lucide-shield', roles: ['ADMIN'] },
  { to: '/app/settings', labelKey: 'nav.settings', icon: 'i-lucide-settings' },
]

/** Items visible to `role` (none of the role-limited ones without a role). */
export function navItemsFor(role: Role | undefined): NavItem[] {
  return APP_NAV.filter(item => !item.roles || (role !== undefined && item.roles.includes(role)))
}

/** `/app` matches only itself; other items also match their sub-routes. */
export function isNavItemActive(item: NavItem, path: string): boolean {
  if (item.to === '/app') return path === '/app' || path === '/app/'
  return path === item.to || path.startsWith(`${item.to}/`)
}
