// nuxt-auth-utils session typing. In shared/types so both the app and server type contexts see it.
import type { SessionUser } from './auth'

declare module '#auth-utils' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface User extends SessionUser {}
}

export {}
