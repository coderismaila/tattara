// /app/** needs a signed-in user; /login sends signed-in users on to the app.
// The server re-checks every request (requireAuth); this only routes the UI. Offline behaviour arrives in 4.5.
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  if (to.path.startsWith('/app') && !loggedIn.value) {
    return navigateTo({ path: '/login', query: { next: to.fullPath } }, { replace: true })
  }
  if (to.path === '/login' && loggedIn.value) {
    return navigateTo('/app', { replace: true })
  }
})
