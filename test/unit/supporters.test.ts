import { describe, expect, it } from 'vitest'
import type { Supporter } from '../../server/db/schema'
import { nameInitials, serializeSupporter, statContribution, statDelta } from '../../server/services/supporters'
import { ROLES } from '../../shared/constants/roles'

const row: Supporter = {
  id: '01923456-789a-7bcd-8ef0-123456789abc',
  puCode: '19/01/01/001',
  fullName: 'Musa Garba',
  phone: '+2348031234567',
  sharedPhone: false,
  address: 'Kusa da masallaci',
  gender: 'male',
  ageBand: '25_34',
  supportLevel: 'strong',
  hasPvc: 'yes',
  volunteer: true,
  consentAt: new Date('2026-09-01T08:00:00Z'),
  consentVersion: 'c1-ha',
  consentLanguage: 'ha',
  gps: { lat: 12.0, lng: 8.52 },
  gpsAccuracyM: 12,
  capturedAt: new Date('2026-09-01T08:00:00Z'),
  capturedBy: '01923456-789a-7bcd-8ef0-000000000001',
  deviceId: 'device-1',
  verification: 'sms_delivered',
  optedOutAt: null,
  status: 'active',
  createdAt: new Date('2026-09-01T08:05:00Z'),
  updatedAt: new Date('2026-09-01T08:05:00Z'),
  updatedBy: null,
}

describe('serializeSupporter', () => {
  it.each(['PU_LEAD', 'WARD_LEAD'] as const)('gives %s the full record, without device id', (role) => {
    const dto = serializeSupporter(row, role)
    expect(dto).toMatchObject({ masked: false, fullName: 'Musa Garba', phone: '+2348031234567', gps: { lat: 12, lng: 8.52, accuracyM: 12 } })
    expect(dto).not.toHaveProperty('deviceId')
    expect(dto).not.toHaveProperty('updatedBy')
  })

  it.each(ROLES.filter(r => r !== 'PU_LEAD' && r !== 'WARD_LEAD'))('masks for %s', (role) => {
    const dto = serializeSupporter(row, role)
    expect(dto).toEqual({
      masked: true,
      id: row.id,
      puCode: row.puCode,
      initials: 'M. G.',
      phone: '+234 80* *** 4567',
      capturedAt: '2026-09-01T08:00:00.000Z',
      verification: 'sms_delivered',
      status: 'active',
    })
    expect(JSON.stringify(dto)).not.toMatch(/Musa|8031234567|masallaci/)
  })

  it('shows nothing identifying for an anonymised record', () => {
    const anon = { ...row, status: 'anonymised' as const, fullName: '—', phone: null, address: null, gps: null }
    expect(serializeSupporter(anon, 'LGA_LEAD')).toMatchObject({ initials: '—', phone: null })
    expect(serializeSupporter(anon, 'PU_LEAD')).toMatchObject({ phone: null, gps: null })
  })
})

describe('nameInitials', () => {
  it('handles hooked letters, apostrophes and extra spaces', () => {
    expect(nameInitials('  ƙabiru   ɗanjuma ')).toBe('Ƙ. Ɗ.')
    expect(nameInitials('Sa\'adatu')).toBe('S.')
    expect(nameInitials('')).toBe('—')
  })
})

describe('pu_stats contributions', () => {
  it('counts each dimension once', () => {
    expect(statContribution(row)).toEqual({
      total: 1, verified: 1, male: 1, female: 0,
      age18_24: 0, age25_34: 1, age35_44: 0, age45_54: 0, age55_64: 0, age65Plus: 0,
      strong: 1, leaning: 0, undecided: 0, hasPvcYes: 1, volunteers: 1, optedOut: 0,
    })
  })

  it('treats call-back verified as verified, and opt-outs apart', () => {
    expect(statContribution({ ...row, verification: 'callback_verified' }).verified).toBe(1)
    expect(statContribution({ ...row, verification: 'callback_failed' }).verified).toBe(0)
    expect(statContribution({ ...row, verification: 'opted_out' })).toMatchObject({ verified: 0, optedOut: 1, total: 1 })
  })

  it('a delta moves counts between buckets and never touches total', () => {
    const d = statDelta(row, { ...row, gender: 'female', ageBand: null, supportLevel: 'leaning', volunteer: false })
    expect(d).toMatchObject({ total: 0, male: -1, female: 1, age25_34: -1, strong: -1, leaning: 1, volunteers: -1, hasPvcYes: 0 })
    expect(statDelta(null, row).total).toBe(1)
  })
})
