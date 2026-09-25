// Signed-in navigation. Add an entry when its page lands (later: capture, supporters, map, team, sync).
export interface NavItem {
  to: string
  labelKey: string
  icon: string
}

export const APP_NAV: readonly NavItem[] = [
  { to: '/app', labelKey: 'nav.home', icon: 'i-lucide-house' },
  { to: '/app/settings', labelKey: 'nav.settings', icon: 'i-lucide-settings' },
]

/** `/app` matches only itself; other items also match their sub-routes. */
export function isNavItemActive(item: NavItem, path: string): boolean {
  if (item.to === '/app') return path === '/app' || path === '/app/'
  return path === item.to || path.startsWith(`${item.to}/`)
}
