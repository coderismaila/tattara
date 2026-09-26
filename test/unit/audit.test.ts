import { describe, expect, it } from 'vitest'
import { AuditPiiError, assertAuditMetaSafe } from '../../server/services/audit'

describe('assertAuditMetaSafe', () => {
  it('accepts IDs, codes, counts and field names', () => {
    expect(() => assertAuditMetaSafe({
      role: 'PU_LEAD',
      unitCode: '19/05/03/012',
      rows: 1200,
      fields: ['fullName', 'phone', 'supportLevel'], // names of changed fields are fine
      exportId: '0190f3a2-1c4b-7d8e-9f0a-1b2c3d4e5f60',
      nested: { reason: 'left the party', ok: true, n: null },
    })).not.toThrow()
  })

  it.each([
    ['phone key', { phone: 'x' }],
    ['name key', { fullName: 'x' }],
    ['address key', { address: 'x' }],
    ['GPS key', { lat: 12 }],
    ['PIN key', { pin: '123456' }],
    ['OTP key', { otp: '123456' }],
    ['nested key', { before: { Phone: 'x' } }],
    ['E.164 value', { note: 'called +2348031234567' }],
    ['local phone value', { note: 'called 08031234567' }],
    ['phone in an array', { targets: ['ok', '2348031234567'] }],
  ])('rejects a %s', (_label, meta) => {
    expect(() => assertAuditMetaSafe(meta)).toThrow(AuditPiiError)
  })

  it('names the offending path', () => {
    expect(() => assertAuditMetaSafe({ a: [{ b: '+2348031234567' }] })).toThrow('meta.a[0].b looks like a phone number')
  })
})
