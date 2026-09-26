// Auth request schemas, shared by the client forms and the server routes (CLAUDE.md: Zod in shared/schemas).
// Error messages are i18n keys; the client translates them.
import { z } from 'zod'
import { normalizePhone } from '../utils/phone'

/** Nigerian mobile, any common format in → E.164 out. */
export const phoneSchema = z.string().trim().transform((value, ctx) => {
  const phone = normalizePhone(value)
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'auth.errors.phoneInvalid' })
    return z.NEVER
  }
  return phone
})

export const pinSchema = z.string().regex(/^\d{6}$/, 'auth.errors.pinFormat')

/** PINs that are too easy to guess: all one digit, straight runs up or down, and a few common patterns. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true
  // Runs may wrap (…8 9 0 1…): the strings repeat enough digits for a 6-long window starting at 9.
  const up = '012345678901234'
  const down = '987654321098765'
  if (up.includes(pin) || down.includes(pin)) return true
  return ['112233', '121212', '123123', '696969', '111222', '101010'].includes(pin)
}

/** A PIN being chosen (setup/reset): format plus the weak-PIN check. Login accepts any 6 digits. */
export const newPinSchema = pinSchema.refine(pin => !isWeakPin(pin), 'auth.errors.pinWeak')

/** Client-generated device id (UUID, kept in localStorage). */
export const deviceIdSchema = z.string().uuid('auth.errors.deviceInvalid')

export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'auth.errors.codeFormat')

/** Invite token from the SMS link: 128 random bits, base64url (22 chars). */
export const inviteTokenSchema = z.string().regex(/^[\w-]{22}$/, 'auth.errors.tokenInvalid')

export const loginSchema = z.object({ phone: phoneSchema, pin: pinSchema, deviceId: deviceIdSchema })
export const otpVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema, deviceId: deviceIdSchema })
export const otpResendSchema = z.object({ phone: phoneSchema })
export const setupSchema = z.object({ token: inviteTokenSchema, pin: newPinSchema, deviceId: deviceIdSchema })

export type LoginInput = z.infer<typeof loginSchema>
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>
export type SetupInput = z.infer<typeof setupSchema>
