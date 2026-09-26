// Authentication (ARCHITECTURE §6, SECURITY_PRIVACY §5): phone + PIN, SMS OTP for new devices, invite setup, lockout.
// Takes the DB and config as arguments so it is testable without Nitro; routes stay thin.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import { auditLog, invites, otpCodes, userDevices, users, type User } from '../db/schema/index.ts'
import { hashPin, verifyPin } from '../utils/pin.ts'
import { RATE_LIMITS, hitRateLimit } from './rate-limit.ts'
import { recordAudit } from './audit.ts'
import { enqueueSms } from './sms.ts'
import { SMS_TEXT } from '../../shared/constants/sms-text.ts'
import type { SessionUser } from '../../shared/types/auth.ts'

export const LOCKOUT = { maxAttempts: 5, minutes: 15, alertAfter: 3, alertWindowHours: 24 } as const
export const OTP_POLICY = { ttlMinutes: 10, maxAttempts: 5 } as const
export const INVITE_TTL_HOURS = 72

export interface AuthConfig {
  /** Keys the OTP HMAC (NUXT_OTP_SECRET). */
  otpSecret: string
  /** Public base URL for invite links, e.g. https://tattara.example */
  siteUrl: string
}

/** Called after an SMS is queued (routes pass a trigger that runs the sms:process task at once). */
export type OnSmsQueued = () => void

type UserRow = Pick<User, 'id' | 'role' | 'unitCode' | 'sessionVersion'>
export const toSessionUser = (u: UserRow): SessionUser => ({ id: u.id, role: u.role, unitCode: u.unitCode, sessionVersion: u.sessionVersion })

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
export const hashOtp = (code: string, secret: string) => createHmac('sha256', secret).update(code).digest('hex')
export const hashInviteToken = (token: string) => sha256(token)

const safeEqualHex = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))

// Verified against for unknown phones so a wrong phone and a wrong PIN take the same time.
let dummyHash: Promise<string> | undefined
const dummyPinHash = () => (dummyHash ??= hashPin('000000-not-a-pin'))

// ── Login ───────────────────────────────────────────────────────────────────

export type LoginResult
  = | { kind: 'ok', user: SessionUser }
    | { kind: 'otp_required' }
    | { kind: 'invalid' }
    | { kind: 'locked', retryAfterSec: number }
    | { kind: 'otp_rate_limited', retryAfterSec: number }

export async function attemptLogin(
  db: Db,
  input: { phone: string, pin: string, deviceId: string },
  cfg: AuthConfig,
  onSmsQueued: OnSmsQueued = () => {},
): Promise<LoginResult> {
  const [user] = await db.select({
    id: users.id,
    role: users.role,
    unitCode: users.unitCode,
    sessionVersion: users.sessionVersion,
    status: users.status,
    pinHash: users.pinHash,
    lockSeconds: sql<number>`greatest(0, ceil(extract(epoch from (${users.lockedUntil} - now()))))::int`,
  }).from(users).where(eq(users.phone, input.phone))

  if (!user || user.status !== 'active' || !user.pinHash) {
    await verifyPin(await dummyPinHash(), input.pin)
    return { kind: 'invalid' }
  }
  if (user.lockSeconds > 0) return { kind: 'locked', retryAfterSec: user.lockSeconds }

  if (!(await verifyPin(user.pinHash, input.pin))) {
    return registerFailedPin(db, user, onSmsQueued)
  }

  await db.update(users).set({ failedPinAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id))

  const [device] = await db.select({ id: userDevices.id }).from(userDevices)
    .where(and(eq(userDevices.userId, user.id), eq(userDevices.deviceId, input.deviceId), isNull(userDevices.revokedAt)))
  if (device) {
    await db.update(userDevices).set({ lastSeenAt: sql`now()` }).where(eq(userDevices.id, device.id))
    await db.update(users).set({ lastSeenAt: sql`now()` }).where(eq(users.id, user.id))
    return { kind: 'ok', user: toSessionUser(user) }
  }

  const issued = await issueDeviceOtp(db, { userId: user.id, phone: input.phone, deviceId: input.deviceId }, cfg, onSmsQueued)
  return issued.kind === 'sent' ? { kind: 'otp_required' } : { kind: 'otp_rate_limited', retryAfterSec: issued.retryAfterSec }
}

async function registerFailedPin(db: Db, user: UserRow, onSmsQueued: OnSmsQueued): Promise<LoginResult> {
  const lockNow = sql`${users.failedPinAttempts} + 1 >= ${LOCKOUT.maxAttempts}`
  const [row] = await db.update(users).set({
    // On lockout the counter restarts, so the next window gets the full 5 attempts.
    failedPinAttempts: sql`case when ${lockNow} then 0 else ${users.failedPinAttempts} + 1 end`,
    lockedUntil: sql`case when ${lockNow} then now() + make_interval(mins => ${LOCKOUT.minutes}) else ${users.lockedUntil} end`,
  }).where(eq(users.id, user.id)).returning({
    lockSeconds: sql<number>`greatest(0, ceil(extract(epoch from (${users.lockedUntil} - now()))))::int`,
  })

  const lockSeconds = row?.lockSeconds ?? 0
  if (lockSeconds === 0) return { kind: 'invalid' }

  await recordAudit(db, { id: user.id, role: user.role, ip: null }, {
    action: 'auth.lockout',
    targetType: 'user',
    targetId: user.id,
    scopeCode: user.unitCode ?? undefined,
  })
  await alertSupervisorOnRepeatedLockouts(db, user, onSmsQueued)
  return { kind: 'locked', retryAfterSec: lockSeconds }
}

/** SECURITY §5: alert the supervising lead after 3 lockouts in 24 h (once, at the third). */
async function alertSupervisorOnRepeatedLockouts(db: Db, user: UserRow, onSmsQueued: OnSmsQueued) {
  const [recent] = await db.select({ n: count() }).from(auditLog).where(and(
    eq(auditLog.action, 'auth.lockout'),
    eq(auditLog.targetId, user.id),
    gt(auditLog.at, sql`now() - make_interval(hours => ${LOCKOUT.alertWindowHours})`),
  ))
  if ((recent?.n ?? 0) !== LOCKOUT.alertAfter) return

  const [row] = await db.select({ invitedBy: users.invitedBy }).from(users).where(eq(users.id, user.id))
  if (!row?.invitedBy) return
  const [supervisor] = await db.select({ phone: users.phone, status: users.status }).from(users).where(eq(users.id, row.invitedBy))
  if (!supervisor || supervisor.status !== 'active') return

  await enqueueSms(db, { to: supervisor.phone, body: SMS_TEXT.lockoutAlert(user.unitCode ?? user.role), purpose: 'otp', scopeCode: user.unitCode ?? undefined })
  onSmsQueued()
}

// ── Device OTP ──────────────────────────────────────────────────────────────

export type IssueOtpResult = { kind: 'sent' } | { kind: 'rate_limited', retryAfterSec: number }

export async function issueDeviceOtp(
  db: Db,
  target: { userId: string, phone: string, deviceId: string },
  cfg: AuthConfig,
  onSmsQueued: OnSmsQueued = () => {},
): Promise<IssueOtpResult> {
  const limit = await hitRateLimit(db, `otp:${target.phone}`, RATE_LIMITS.otpSend)
  if (!limit.allowed) return { kind: 'rate_limited', retryAfterSec: limit.retryAfterSec }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await db.transaction(async (tx) => {
    // Only the newest code works.
    await tx.update(otpCodes).set({ consumedAt: sql`now()` })
      .where(and(eq(otpCodes.phone, target.phone), eq(otpCodes.purpose, 'device'), isNull(otpCodes.consumedAt)))
    await tx.insert(otpCodes).values({
      phone: target.phone,
      purpose: 'device',
      codeHash: hashOtp(code, cfg.otpSecret),
      deviceId: target.deviceId,
      expiresAt: sql`now() + make_interval(mins => ${OTP_POLICY.ttlMinutes})`,
    })
    await enqueueSms(tx, { to: target.phone, body: SMS_TEXT.otp(code), purpose: 'otp', createdBy: target.userId })
  })
  onSmsQueued()
  return { kind: 'sent' }
}

export type VerifyOtpResult
  = | { kind: 'ok', user: SessionUser }
    | { kind: 'invalid' }
    | { kind: 'expired' }
    | { kind: 'too_many_attempts' }

export async function verifyDeviceOtp(
  db: Db,
  input: { phone: string, code: string, deviceId: string },
  cfg: AuthConfig,
): Promise<VerifyOtpResult> {
  const [otp] = await db.select({
    id: otpCodes.id,
    codeHash: otpCodes.codeHash,
    deviceId: otpCodes.deviceId,
    attempts: otpCodes.attempts,
    expired: sql<boolean>`${otpCodes.expiresAt} <= now()`,
  }).from(otpCodes)
    .where(and(eq(otpCodes.phone, input.phone), eq(otpCodes.purpose, 'device'), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)

  // A code is bound to the device that passed the PIN check.
  if (!otp || otp.deviceId !== input.deviceId) return { kind: 'invalid' }
  if (otp.expired) return { kind: 'expired' }
  if (otp.attempts >= OTP_POLICY.maxAttempts) return { kind: 'too_many_attempts' }

  if (!safeEqualHex(hashOtp(input.code, cfg.otpSecret), otp.codeHash)) {
    const [row] = await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, otp.id)).returning({ attempts: otpCodes.attempts })
    return (row?.attempts ?? 0) >= OTP_POLICY.maxAttempts ? { kind: 'too_many_attempts' } : { kind: 'invalid' }
  }

  const [user] = await db.select().from(users).where(and(eq(users.phone, input.phone), eq(users.status, 'active')))
  if (!user) return { kind: 'invalid' }

  await db.transaction(async (tx) => {
    await tx.update(otpCodes).set({ consumedAt: sql`now()` }).where(eq(otpCodes.id, otp.id))
    await trustDevice(tx, user.id, input.deviceId)
    await tx.update(users).set({ lastSeenAt: sql`now()` }).where(eq(users.id, user.id))
  })
  return { kind: 'ok', user: toSessionUser(user) }
}

/** Resend the code for a pending (PIN-verified, still valid) login. Silent when there is none. */
export async function resendDeviceOtp(
  db: Db,
  phone: string,
  cfg: AuthConfig,
  onSmsQueued: OnSmsQueued = () => {},
): Promise<IssueOtpResult | { kind: 'nothing_pending' }> {
  const [pending] = await db.select({ deviceId: otpCodes.deviceId }).from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, 'device'), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, sql`now()`)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1)
  const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.phone, phone), eq(users.status, 'active')))
  if (!pending?.deviceId || !user) return { kind: 'nothing_pending' }
  return issueDeviceOtp(db, { userId: user.id, phone, deviceId: pending.deviceId }, cfg, onSmsQueued)
}

async function trustDevice(db: DbLike, userId: string, deviceId: string) {
  await db.insert(userDevices).values({ userId, deviceId }).onConflictDoUpdate({
    target: [userDevices.userId, userDevices.deviceId],
    set: { revokedAt: null, lastSeenAt: sql`now()` },
  })
}

// ── Invites and setup ───────────────────────────────────────────────────────

/** Create a single-use invite for `userId` (replacing any unused one). Returns the raw token; only its hash is stored. */
export async function createInvite(db: Db, userId: string, createdBy: string | null): Promise<string> {
  const token = randomBytes(16).toString('base64url')
  await db.transaction(async (tx) => {
    await tx.update(invites).set({ expiresAt: sql`now()` }).where(and(eq(invites.userId, userId), isNull(invites.usedAt)))
    await tx.insert(invites).values({
      userId,
      tokenHash: hashInviteToken(token),
      createdBy,
      expiresAt: sql`now() + make_interval(hours => ${INVITE_TTL_HOURS})`,
    })
  })
  return token
}

export const inviteUrl = (cfg: AuthConfig, token: string) => `${cfg.siteUrl.replace(/\/+$/, '')}/setup?t=${token}`

/** Create an invite and text the link to the user (US-1). */
export async function sendInvite(db: Db, userId: string, createdBy: string | null, cfg: AuthConfig, onSmsQueued: OnSmsQueued = () => {}) {
  const [user] = await db.select({ phone: users.phone, unitCode: users.unitCode }).from(users).where(eq(users.id, userId))
  if (!user) throw new Error('sendInvite: unknown user')
  const token = await createInvite(db, userId, createdBy)
  await enqueueSms(db, { to: user.phone, body: SMS_TEXT.invite(inviteUrl(cfg, token)), purpose: 'invite', scopeCode: user.unitCode ?? undefined, createdBy: createdBy ?? undefined })
  onSmsQueued()
}

export type SetupResult
  = | { kind: 'ok', user: SessionUser }
    | { kind: 'invalid' }
    | { kind: 'expired' }
    | { kind: 'unit_taken' }

/** Invite link → choose a PIN → active, with this device trusted (the SMS link proves the phone). */
export async function completeSetup(db: Db, input: { token: string, pin: string, deviceId: string }): Promise<SetupResult> {
  const [invite] = await db.select({
    id: invites.id,
    userId: invites.userId,
    expired: sql<boolean>`${invites.expiresAt} <= now()`,
  }).from(invites).where(and(eq(invites.tokenHash, hashInviteToken(input.token)), isNull(invites.usedAt)))
  if (!invite) return { kind: 'invalid' }
  if (invite.expired) return { kind: 'expired' }

  const [target] = await db.select({ status: users.status }).from(users).where(eq(users.id, invite.userId))
  if (!target || target.status === 'deactivated') return { kind: 'invalid' }

  const pinHash = await hashPin(input.pin)
  try {
    const user = await db.transaction(async (tx) => {
      const [updated] = await tx.update(users).set({
        pinHash,
        status: 'active',
        failedPinAttempts: 0,
        lockedUntil: null,
        // Any session from before a PIN (re)set stops working.
        sessionVersion: sql`${users.sessionVersion} + 1`,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      }).where(eq(users.id, invite.userId)).returning()
      await tx.update(invites).set({ usedAt: sql`now()` }).where(eq(invites.id, invite.id))
      await trustDevice(tx, invite.userId, input.deviceId)
      return updated!
    })
    await recordAudit(db, { id: user.id, role: user.role, ip: null }, {
      action: 'user.activate',
      targetType: 'user',
      targetId: user.id,
      scopeCode: user.unitCode ?? undefined,
    })
    return { kind: 'ok', user: toSessionUser(user) }
  }
  catch (error) {
    // Another active lead already holds this unit (users_one_active_per_unit_idx).
    const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code
    if (code === '23505') return { kind: 'unit_taken' }
    throw error
  }
}
