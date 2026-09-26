// nuxt-auth-utils session typing. In shared/types so both the app and server type contexts see it.
import type { SecureSession, SessionUser } from './auth'

declare module '#auth-utils' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface User extends SessionUser {}
  // Server-only part of the session (never sent to the browser).
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SecureSessionData extends Partial<SecureSession> {}
}

export {}
