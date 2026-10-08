// Task 5.2: the SMS webhook's signature check and payload parsing, STOP detection, and the supporter SMS texts.
import { describe, expect, it } from 'vitest'
import { SUPPORTER_SMS_TEXT } from '../../shared/constants/sms-text'
import { isGsm7 } from '../../server/utils/sms/types'
import { isStopMessage, parseSmsWebhook, signSmsWebhook, verifySmsSignature } from '../../server/utils/sms/webhook'

const SECRET = 'webhook-secret-for-tests'

describe('verifySmsSignature (HMAC-SHA512 of the raw body)', () => {
  const body = JSON.stringify({ type: 'outbound', message_id: '3017', status: 'Delivered' })

  it('accepts the right signature, in either case', () => {
    const sig = signSmsWebhook(body, SECRET)
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
    expect(verifySmsSignature(body, sig, SECRET)).toBe(true)
    expect(verifySmsSignature(body, sig.toUpperCase(), SECRET)).toBe(true)
  })

  it('refuses a missing, malformed, wrong-key or tampered signature, and an empty secret', () => {
    const sig = signSmsWebhook(body, SECRET)
    expect(verifySmsSignature(body, undefined, SECRET)).toBe(false)
    expect(verifySmsSignature(body, 'not-hex', SECRET)).toBe(false)
    expect(verifySmsSignature(body, sig.slice(2), SECRET)).toBe(false)
    expect(verifySmsSignature(body, signSmsWebhook(body, 'other-secret'), SECRET)).toBe(false)
    expect(verifySmsSignature(`${body} `, sig, SECRET)).toBe(false)
    expect(verifySmsSignature(body, signSmsWebhook(body, ''), '')).toBe(false)
  })
})

describe('parseSmsWebhook (Termii-shaped events)', () => {
  it('reads delivery reports by message id', () => {
    const base = { type: 'outbound', id: 'req-1', message_id: '3017', receiver: '2348031234567', sender: 'Tattara', channel: 'dnd' }
    expect(parseSmsWebhook({ ...base, status: 'DELIVERED' })).toEqual({ kind: 'delivery', providerRef: '3017', status: 'delivered' })
    expect(parseSmsWebhook({ ...base, status: 'Message Failed' })).toMatchObject({ status: 'failed' })
    expect(parseSmsWebhook({ ...base, status: 'DND Active on Phone Number' })).toMatchObject({ status: 'failed' })
    expect(parseSmsWebhook({ ...base, status: 'Rejected' })).toMatchObject({ status: 'failed' })
    expect(parseSmsWebhook({ ...base, status: 'Expired' })).toMatchObject({ status: 'failed' })
  })

  it('ignores intermediate states and shapes it does not know', () => {
    expect(parseSmsWebhook({ type: 'outbound', message_id: '1', status: 'Message Sent' })).toMatchObject({ kind: 'ignored' })
    expect(parseSmsWebhook({ status: 'Delivered' })).toMatchObject({ kind: 'ignored' })
    expect(parseSmsWebhook(null)).toMatchObject({ kind: 'ignored' })
    expect(parseSmsWebhook([1, 2])).toMatchObject({ kind: 'ignored' })
  })

  it('reads inbound replies, normalising the sender to E.164', () => {
    expect(parseSmsWebhook({ type: 'inbound', sender: '2348031234567', message: 'STOP' }))
      .toEqual({ kind: 'inbound', from: '+2348031234567', text: 'STOP' })
    expect(parseSmsWebhook({ status: 'Received', from: '08031234567', sms: 'stop' }))
      .toEqual({ kind: 'inbound', from: '+2348031234567', text: 'stop' })
    expect(parseSmsWebhook({ type: 'inbound', sender: 'MTN', message: 'promo' })).toMatchObject({ kind: 'ignored' })
  })
})

describe('isStopMessage', () => {
  it.each(['STOP', 'stop', ' Stop. ', 'STOP ALL', 'stop please', 'Unsubscribe', 'CIRE', 'daina', 'opt out'])('%s → stop', (text) => {
    expect(isStopMessage(text)).toBe(true)
  })
  it.each(['', 'Thanks', 'I support you', 'stopped by yesterday', 'please stop'])('%s → not stop', (text) => {
    expect(isStopMessage(text)).toBe(false)
  })
})

describe('supporter SMS texts', () => {
  const variants = [
    { orgName: '', replyNumber: '' },
    { orgName: 'Northern Progressive Alliance', replyNumber: '+2348031234567' },
  ]
  it('fit one GSM-7 segment (≤ 160 chars) in both languages, with or without a reply number', () => {
    for (const o of variants) {
      for (const text of [SUPPORTER_SMS_TEXT.thankYou.ha(o), SUPPORTER_SMS_TEXT.thankYou.en(o), SUPPORTER_SMS_TEXT.optOutConfirm.ha(o), SUPPORTER_SMS_TEXT.optOutConfirm.en(o)]) {
        expect(isGsm7(text), text).toBe(true)
        expect(text.length, text).toBeLessThanOrEqual(160)
      }
    }
  })

  it('tell the supporter how to opt out', () => {
    expect(SUPPORTER_SMS_TEXT.thankYou.en(variants[1]!)).toContain('reply STOP to +2348031234567')
    expect(SUPPORTER_SMS_TEXT.thankYou.ha(variants[1]!)).toContain('STOP zuwa +2348031234567')
    expect(SUPPORTER_SMS_TEXT.thankYou.en(variants[0]!)).toMatch(/^Tattara: .*polling unit lead\.$/)
  })
})
