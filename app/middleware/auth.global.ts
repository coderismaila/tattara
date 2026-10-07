// /app/** needs a signed-in user; /login sends signed-in users on to the app.
// The server re-checks every request (requireAuth); this only routes the UI.
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  if (to.path.startsWith('/app') && !loggedIn.value) {
    // Offline the session can't be confirmed: let the cached shell open (ADR-034). The app layout keeps it behind the
    // lock screen: it opens only with this phone's local session and the lead's PIN (4.5, ADR-036).
    if (import.meta.client && !navigator.onLine) return
    return navigateTo({ path: '/login', query: { next: to.fullPath } }, { replace: true })
  }
  if (to.path === '/login' && loggedIn.value) {
    return navigateTo('/app', { replace: true })
  }
})
