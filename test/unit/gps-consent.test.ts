import { describe, expect, it } from 'vitest'
import { GPS_MAX_AGE_MS, freshFix, toTimedFix } from '../../app/utils/gps'
import { CONSENT_VERSIONS, CURRENT_CONSENT_VERSION, consentLanguageOf, consentScript } from '../../shared/constants/consent'

describe('GPS helpers', () => {
  const position = { coords: { latitude: 12.00001234, longitude: 8.5199996, accuracy: 12.6 }, timestamp: 1_000_000 } as GeolocationPosition

  it('rounds to 6 decimals and whole metres', () => {
    expect(toTimedFix(position)).toEqual({ lat: 12.000012, lng: 8.52, accuracyM: 13, at: 1_000_000 })
  })

  it('keeps a missing accuracy as null', () => {
    expect(toTimedFix({ ...position, coords: { ...position.coords, accuracy: Number.NaN } }).accuracyM).toBeNull()
  })

  it('only attaches a recent fix', () => {
    const fix = toTimedFix(position)
    expect(freshFix(fix, 1_000_000 + GPS_MAX_AGE_MS)).toEqual({ lat: 12.000012, lng: 8.52, accuracyM: 13 })
    expect(freshFix(fix, 1_000_001 + GPS_MAX_AGE_MS)).toBeNull()
    expect(freshFix(null, 1_000_000)).toBeNull()
  })
})

describe('consent scripts', () => {
  it.each(CONSENT_VERSIONS)('%s names the organisation, the data kept and how to opt out', (version) => {
    const text = consentScript(version, '  Example Group ')
    expect(text.startsWith('Example Group ')).toBe(true)
    expect(text).toContain('STOP')
    expect(text.trim().endsWith('?')).toBe(true)
  })

  it('falls back to a neutral name in the script\'s language', () => {
    expect(consentScript('c1-ha', '')).toMatch(/^Jam'iyya /)
    expect(consentScript('c1-en', null)).toMatch(/^The party /)
  })

  it('never mentions voter registration or collects sensitive data', () => {
    for (const version of CONSENT_VERSIONS) {
      expect(consentScript(version).toLowerCase()).not.toMatch(/\b(?:regist\w*|pvc|vin|nin|bvn|religio\w*|ethnic\w*)\b/)
    }
  })

  it('the current version per language is in that language', () => {
    expect(consentLanguageOf(CURRENT_CONSENT_VERSION.ha)).toBe('ha')
    expect(consentLanguageOf(CURRENT_CONSENT_VERSION.en)).toBe('en')
  })
})
