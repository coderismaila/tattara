import type { Role } from '../constants/roles'

/**
 * The user stored in the sealed session cookie (set at login, task 2.4). IDs and codes only: no phone or name,
 * because the cookie travels with every request. nuxt-auth-utils' `User` is augmented to this in auth.d.ts.
 */
export interface SessionUser {
  id: string
  role: Role
  /** INEC unit code; null for ADMIN and DG (region-wide). */
  unitCode: string | null
  /** Must equal users.session_version; bumping it revokes sessions (2.4). */
  sessionVersion: number
}

/** Server-only session data (nuxt-auth-utils `secure`): never sent to the client. */
export interface SecureSession {
  /** The device this session was established on (user_devices.device_id). */
  deviceId: string
  /** Epoch ms of the last activity refresh; sessions end after 30 days without one. */
  refreshedAt: number
  loggedInAt: number
}
