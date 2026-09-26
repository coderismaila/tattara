import { describe, expect, it } from 'vitest'
import { isValidPhone, maskPhoneForDisplay, normalizePhone } from '../../shared/utils/phone'

describe('normalizePhone', () => {
  it.each([
    ['local with trunk 0', '08031234567'],
    ['national without 0', '8031234567'],
    ['E.164', '+2348031234567'],
    ['country code without +', '2348031234567'],
    ['spaces', '0803 123 4567'],
    ['dashes', '0803-123-4567'],
    ['E.164 with spaces', '+234 803 123 4567'],
    ['brackets and dots', '(0803) 123.4567'],
    ['surrounding whitespace', '  08031234567  '],
    // Common entry mistake: trunk 0 kept after the country code. Unambiguous, so accepted.
    ['E.164 with trunk 0', '+234 0803 123 4567'],
  ])('normalises %s', (_label, input) => {
    expect(normalizePhone(input)).toBe('+2348031234567')
  })

  it.each([
    ['0701', '07012345678', '+2347012345678'],
    ['0706', '07061234567', '+2347061234567'],
    ['0810', '08101234567', '+2348101234567'],
    ['0905', '09051234567', '+2349051234567'],
    ['0913', '09131234567', '+2349131234567'],
  ])('accepts the %s mobile range', (_label, input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })

  it.each([
    ['empty', ''],
    ['too short', '0803123456'],
    ['too long', '080312345678'],
    ['letters', '0803ABC4567'],
    ['Lagos landline', '012345678'],
    ['Kano landline', '064123456'],
    ['UK mobile', '+447911123456'],
    ['US number', '+12025550123'],
    ['not a mobile prefix', '06031234567'],
    ['plus in the middle', '0803+1234567'],
    ['only symbols', '+-- ()'],
  ])('rejects %s', (_label, input) => {
    expect(normalizePhone(input)).toBeNull()
    expect(isValidPhone(input)).toBe(false)
  })
})

describe('maskPhoneForDisplay', () => {
  it('keeps the network prefix and last 4 digits only', () => {
    expect(maskPhoneForDisplay('+2348031234567')).toBe('+234 80* *** 4567')
  })

  it('hides anything that is not an E.164 NG mobile', () => {
    expect(maskPhoneForDisplay('08031234567')).toBe('***')
    expect(maskPhoneForDisplay('')).toBe('***')
  })
})
