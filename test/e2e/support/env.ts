// Shared E2E settings: a dedicated database, the fake-SMS outbox file and fixture files.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const E2E_PORT = 3131
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Admin connection used to (re)create the E2E database. */
export const ADMIN_DB_URL = process.env.NUXT_DATABASE_URL ?? 'postgres://tattara:tattara@localhost:5432/tattara'
export const E2E_DB_URL = (() => {
  const url = new URL(ADMIN_DB_URL)
  url.pathname = '/tattara_e2e'
  return url.toString()
})()

export const OUTBOX_FILE = `${ROOT}test-results/sms-outbox.ndjson`
export const FIXTURE_FILE = `${ROOT}test-results/e2e-fixture.json`
export const AUTH_STATE_FILE = `${ROOT}test-results/auth-state.json`
/** Session of the seeded Kano PU lead (19/01/01/001), for the capture tests. */
export const PU_AUTH_STATE_FILE = `${ROOT}test-results/pu-auth-state.json`
/** Session of the seeded Kano LGA lead (19/01), for the masked flag review (5.4). */
export const LGA_AUTH_STATE_FILE = `${ROOT}test-results/lga-auth-state.json`
export const LGA_USER_PHONE = '08000000102'

export const DEV_PIN = '123456'
/** Seeded Kano ward lead: signed in once by auth.setup.ts for the app-shell tests. */
export const SHELL_USER_PHONE = '08000000103'
/** Seeded Kano PU lead: signed in once by auth.setup.ts for the capture tests. */
export const PU_USER_PHONE = '08000000104'
/** Active PU lead created by global-setup on a PU with no registered-voter figure (3.7). */
export const VOTERS_USER_PHONE = '08031000004'
export const VOTERS_PU = '19/01/01/004'
/** Seeded Katsina ward lead: the lockout test's target (kept apart from everyone else's attempts). */
export const LOCKOUT_USER_PHONE = '08000000203'

export interface E2EFixture {
  invitedPhone: string
  inviteToken: string
}

export const readFixture = (): E2EFixture => JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as E2EFixture

interface OutboxMessage { to: string, body: string, purpose: string }

/** One outbox line, or null for a line the server is still writing (the file is appended while tests read it). */
function parseLine(line: string): OutboxMessage | null {
  try {
    return JSON.parse(line) as OutboxMessage
  }
  catch {
    return null
  }
}

/** Latest OTP the fake SMS provider "sent" to `phone` (E.164). */
export function latestOtp(phone: string): string | null {
  let lines: string[]
  try {
    lines = readFileSync(OUTBOX_FILE, 'utf8').trim().split('\n')
  }
  catch {
    return null
  }
  for (const line of lines.reverse()) {
    const msg = parseLine(line)
    if (!msg) continue
    if (msg.to === phone && msg.purpose === 'otp') return /\b(\d{6})\b/.exec(msg.body)?.[1] ?? null
  }
  return null
}

/** Invite token from the latest invite SMS the fake provider "sent" to `phone` (E.164). */
export function latestInviteToken(phone: string): string | null {
  let lines: string[]
  try {
    lines = readFileSync(OUTBOX_FILE, 'utf8').trim().split('\n')
  }
  catch {
    return null
  }
  for (const line of lines.reverse()) {
    const msg = parseLine(line)
    if (!msg) continue
    if (msg.to === phone && msg.purpose === 'invite') return /\/setup\?t=([\w-]{22})/.exec(msg.body)?.[1] ?? null
  }
  return null
}

/** The latest OTP for `phone` if it differs from `before` (an older code already in the outbox), else null. */
export function newOtp(phone: string, before: string | null): string | null {
  const code = latestOtp(phone)
  return code === before ? null : code
}
