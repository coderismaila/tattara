// Stand-in for `#auth-session` in plain-Node test projects. The real module needs the Nitro runtime; tests that
// exercise sessions mock `server/auth/session.ts` instead (vi.mock).
const unavailable = () => {
  throw new Error('Session helpers are not available in node tests: vi.mock("server/auth/session.ts").')
}
export const getUserSession = unavailable
export const requireUserSession = unavailable
export const setUserSession = unavailable
export const clearUserSession = unavailable
export const replaceUserSession = unavailable
