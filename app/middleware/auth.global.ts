// /app/** needs a signed-in user; /login sends signed-in users on to the app.
// The server re-checks every request (requireAuth); this only routes the UI. Offline session handling arrives in 4.5.
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  if (to.path.startsWith('/app') && !loggedIn.value) {
    // Offline the session can't be confirmed: let the cached shell open (ADR-034). Every screen still needs the API
    // for data; 4.5 adds the local PIN lock, which must be in place before 4.2 keeps supporters on the device.
    if (import.meta.client && !navigator.onLine) return
    return navigateTo({ path: '/login', query: { next: to.fullPath } }, { replace: true })
  }
  if (to.path === '/login' && loggedIn.value) {
    return navigateTo('/app', { replace: true })
  }
})
