import { describe, expect, it } from 'vitest'
import { isSameOrigin } from '../../server/middleware/origin'
import { hashOtp, inviteUrl } from '../../server/services/auth'
import { authErrorMessage } from '../../app/utils/auth-errors'
import { inviteTokenSchema, isWeakPin, loginSchema, newPinSchema, setupSchema } from '../../shared/schemas/auth'
import { SMS_TEXT } from '../../shared/constants/sms-text'
import { isGsm7 } from '../../server/utils/sms/types'
import { newId } from '../../shared/utils/uuid'

describe('auth schemas', () => {
  it('normalises the phone and accepts a UUIDv7 device id', () => {
    const parsed = loginSchema.parse({ phone: '0803 123 4567', pin: '482915', deviceId: newId() })
    expect(parsed.phone).toBe('+2348031234567')
  })

  it('rejects bad phones, PIN formats and device ids with i18n keys', () => {
    const r = loginSchema.safeParse({ phone: '012345678', pin: '12345', deviceId: 'nope' })
    expect(r.success).toBe(false)
    expect(r.error!.issues.map(i => i.message)).toEqual(['auth.errors.phoneInvalid', 'auth.errors.pinFormat', 'auth.errors.deviceInvalid'])
  })

  it.each(['000000', '111111', '123456', '234567', '654321', '987654', '890123', '121212', '112233'])('treats %s as a weak PIN', (pin) => {
    expect(isWeakPin(pin)).toBe(true)
    expect(newPinSchema.safeParse(pin).error?.issues[0]?.message).toBe('auth.errors.pinWeak')
  })

  it.each(['482915', '705312', '190284'])('accepts %s as a new PIN', (pin) => {
    expect(isWeakPin(pin)).toBe(false)
  })

  it('login accepts any 6 digits (weak PINs set before the rule still log in)', () => {
    expect(loginSchema.safeParse({ phone: '08031234567', pin: '123456', deviceId: newId() }).success).toBe(true)
    expect(setupSchema.safeParse({ token: 'a'.repeat(22), pin: '123456', deviceId: newId() }).success).toBe(false)
  })

  it('invite tokens are 22 base64url characters', () => {
    expect(inviteTokenSchema.safeParse('Xk3_-9aZqL0mN7pQrS2tUv').success).toBe(true)
    expect(inviteTokenSchema.safeParse('short').success).toBe(false)
    expect(inviteTokenSchema.safeParse('a'.repeat(21) + '/').success).toBe(false)
  })
})

describe('auth helpers', () => {
  it('OTP HMAC depends on the secret', () => {
    expect(hashOtp('123456', 'a'.repeat(32))).not.toBe(hashOtp('123456', 'b'.repeat(32)))
    expect(hashOtp('123456', 'a'.repeat(32))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('builds invite URLs without double slashes', () => {
    expect(inviteUrl({ otpSecret: '', siteUrl: 'https://t.ng/' }, 'TOKEN')).toBe('https://t.ng/setup?t=TOKEN')
  })

  it('keeps transactional SMS in GSM-7 and one segment (cost, ADR-024)', () => {
    const texts = [SMS_TEXT.otp('123456'), SMS_TEXT.invite(`https://tattara.example.ng/setup?t=${'x'.repeat(22)}`), SMS_TEXT.lockoutAlert('19/05/03/012')]
    for (const text of texts) {
      expect(isGsm7(text), text).toBe(true)
      expect(text.length, text).toBeLessThanOrEqual(160)
    }
  })

  it('same-origin check (CSRF)', () => {
    const url = new URL('https://tattara.ng/api/auth/login')
    expect(isSameOrigin('https://tattara.ng', url)).toBe(true)
    expect(isSameOrigin('https://tattara.ng/login?x=1', url)).toBe(true) // Referer form
    expect(isSameOrigin('https://evil.ng', url)).toBe(false)
    expect(isSameOrigin('http://tattara.ng', url)).toBe(false)
    expect(isSameOrigin(undefined, url)).toBe(false)
    expect(isSameOrigin('not a url', url)).toBe(false)
  })

  it('maps API errors to i18n keys with minutes', () => {
    expect(authErrorMessage({ statusCode: 423, data: { data: { reason: 'locked', retryAfterSec: 840 } } })).toEqual({ key: 'auth.errors.locked', params: { minutes: 14 } })
    expect(authErrorMessage({ statusCode: 401, data: { data: { reason: 'invalid_credentials' } } })).toEqual({ key: 'auth.errors.invalid_credentials' })
    expect(authErrorMessage({ statusCode: 400, data: { data: { reason: 'invalid', issues: [{ message: 'auth.errors.pinWeak' }] } } })).toEqual({ key: 'auth.errors.pinWeak' })
    expect(authErrorMessage(new TypeError('fetch failed'))).toEqual({ key: 'auth.errors.network' })
    expect(authErrorMessage({ statusCode: 500 })).toEqual({ key: 'auth.errors.unknown' })
  })
})
