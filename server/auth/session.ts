// Session helpers from nuxt-auth-utils, via the `#auth-session` alias (nuxt.config.ts, ADR-023).
// Import them from here only: one seam to mock in tests and to adapt if the module changes.
// Kept out of server/utils because Nitro registers every server/utils export as a server import.
export { clearUserSession, getUserSession, replaceUserSession, requireUserSession, setUserSession } from '#auth-session'
