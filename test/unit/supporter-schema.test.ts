import { readFileSync } from 'node:fs'
import JSON5 from 'json5'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { supporterFormSchema, supporterInputSchema, supporterPatchSchema } from '../../shared/schemas/supporter'
import type { SupporterInput } from '../../shared/types/supporter'

const valid = {
  id: '01923456-789a-7bcd-8ef0-123456789abc',
  puCode: '19/01/01/001',
  fullName: '  Musa   Garba ',
  phone: '0803 123 4567',
  sharedPhone: false,
  address: '  Kusa da masallaci ',
  gender: 'male',
  ageBand: '25_34',
  supportLevel: 'strong',
  hasPvc: 'yes',
  volunteer: true,
  consentAt: '2026-09-26T08:00:00.000Z',
  consentVersion: 'c1-ha',
  consentLanguage: 'ha',
  gps: { lat: 12.0, lng: 8.52, accuracyM: 12 },
  capturedAt: '2026-09-26T09:00:05+01:00',
  deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
}

/** The i18n keys of the issues when `data` fails. */
const errors = (schema: z.ZodType, data: unknown) => {
  const r = schema.safeParse(data)
  return r.success ? [] : r.error.issues.map(i => i.message)
}

describe('supporterInputSchema', () => {
  it('accepts a capture and normalises name, phone and address', () => {
    expect(supporterInputSchema.parse(valid)).toMatchObject({
      fullName: 'Musa Garba',
      phone: '+2348031234567',
      address: 'Kusa da masallaci',
      gps: { lat: 12, lng: 8.52, accuracyM: 12 },
    })
  })

  it('fills optional fields with null or false', () => {
    const { address: _a, gender: _g, ageBand: _b, gps: _p, sharedPhone: _s, volunteer: _v, ...required } = valid
    expect(supporterInputSchema.parse({ ...required, address: '   ' })).toMatchObject({
      address: null, gender: null, ageBand: null, gps: null, sharedPhone: false, volunteer: false,
    })
  })

  it.each([
    ['a one-letter name', { fullName: ' M ' }, 'supporter.errors.nameRequired'],
    ['a 121-char name', { fullName: 'a'.repeat(121) }, 'supporter.errors.nameTooLong'],
    ['a landline', { phone: '01 234 5678' }, 'auth.errors.phoneInvalid'],
    ['a 201-char address', { address: 'x'.repeat(201) }, 'supporter.errors.addressTooLong'],
    ['no support level', { supportLevel: undefined }, 'supporter.errors.supportRequired'],
    ['an unknown support level', { supportLevel: 'maybe' }, 'supporter.errors.supportRequired'],
    ['no PVC answer', { hasPvc: undefined }, 'supporter.errors.pvcRequired'],
    ['no consent version', { consentVersion: undefined }, 'supporter.errors.consentRequired'],
    ['an unknown consent version', { consentVersion: 'c9-ha' }, 'supporter.errors.consentRequired'],
    ['a consent language that does not match the version', { consentLanguage: 'en' }, 'supporter.errors.consentRequired'],
    ['consent long after capture', { consentAt: '2026-09-26T08:02:00.000Z' }, 'supporter.errors.consentAfterCapture'],
    ['no consent time', { consentAt: undefined }, 'supporter.errors.invalid'],
    ['a UUIDv4 id', { id: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e' }, 'supporter.errors.invalid'],
    ['a ward code', { puCode: '19/01/01' }, 'supporter.errors.puInvalid'],
    ['a malformed code', { puCode: '19/1/1/1' }, 'supporter.errors.puInvalid'],
    ['a latitude out of range', { gps: { lat: 91, lng: 8, accuracyM: 5 } }, 'supporter.errors.gpsInvalid'],
    ['a negative accuracy', { gps: { lat: 12, lng: 8, accuracyM: -1 } }, 'supporter.errors.gpsInvalid'],
    ['a capture time without offset', { capturedAt: '2026-09-26 08:00' }, 'supporter.errors.invalid'],
  ])('rejects %s', (_label, over, key) => {
    expect(errors(supporterInputSchema, { ...valid, ...over })).toContain(key)
  })

  it('allows consent a few seconds after the capture time (same phone clock)', () => {
    expect(supporterInputSchema.safeParse({ ...valid, consentAt: '2026-09-26T08:00:30+00:00' }).success).toBe(true)
  })

  it.each(['pvcNumber', 'vin', 'nin', 'bvn', 'religion', 'ethnicity', 'capturedBy', 'verification'])('rejects the unknown key %s', (key) => {
    expect(supporterInputSchema.safeParse({ ...valid, [key]: 'x' }).success).toBe(false)
    expect(supporterInputSchema.safeParse({ ...valid, gps: { ...valid.gps, [key]: 'x' } }).success).toBe(false)
  })

  it('outputs exactly SupporterInput', () => {
    expectTypeOf<z.output<typeof supporterInputSchema>>().toEqualTypeOf<SupporterInput>()
  })
})

describe('supporterFormSchema', () => {
  const form = { fullName: 'Musa Garba', phone: '08031234567', supportLevel: 'strong', hasPvc: 'yes' }

  it('requires the consent tick', () => {
    expect(supporterFormSchema.safeParse({ ...form, consentGiven: true }).success).toBe(true)
    expect(errors(supporterFormSchema, form)).toEqual(['supporter.errors.consentRequired'])
    expect(errors(supporterFormSchema, { ...form, consentGiven: false })).toEqual(['supporter.errors.consentRequired'])
  })
})

describe('supporterPatchSchema', () => {
  it('keeps omitted fields out and lets null clear an optional one', () => {
    expect(supporterPatchSchema.parse({ gender: null, phone: '0803 123 4567' })).toEqual({ gender: null, phone: '+2348031234567' })
    expect(supporterPatchSchema.parse({ address: '  ' })).toEqual({ address: null })
  })

  it('needs at least one change', () => {
    expect(errors(supporterPatchSchema, {})).toEqual(['supporter.errors.nothingToSave'])
  })

  it.each(['puCode', 'consentAt', 'consentVersion', 'capturedAt', 'capturedBy', 'id', 'nin'])('rejects %s', (key) => {
    expect(supporterPatchSchema.safeParse({ volunteer: true, [key]: 'x' }).success).toBe(false)
  })
})

describe('error keys', () => {
  const load = (file: string) => JSON5.parse(readFileSync(new URL(`../../i18n/locales/${file}`, import.meta.url), 'utf8'))
  const source = readFileSync(new URL('../../shared/schemas/supporter.ts', import.meta.url), 'utf8')
  const used = [...new Set(source.match(/supporter\.errors\.\w+/g))]

  it.each(['ha.json5', 'en.json'])('every key the schema uses exists in %s', (file) => {
    const errorsObj = load(file).supporter.errors as Record<string, string>
    for (const key of used) expect(errorsObj[key.split('.').pop()!], key).toBeTruthy()
  })
})
