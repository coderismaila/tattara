import { describe, expect, it } from 'vitest'
import { generateDevGeography } from '../../scripts/seed/dev-geography'
import { DEV_SUPPORTER_COUNT, DEV_SUPPORTER_PHONE_PREFIX, generateDevSupporters } from '../../scripts/seed/dev-supporters'
import { isUuidV7 } from '../../shared/utils/uuid'

const pus = generateDevGeography().units.filter(u => u.level === 'pu')
const leads = { 19: 'lead-kano', 20: 'lead-katsina' }
const { supporters, patterns } = generateDevSupporters(pus, leads)

/** Great-circle distance in km. */
function km(a: { lat: number, lng: number }, b: { lat: number, lng: number }) {
  const r = (d: number) => d * Math.PI / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

describe('generateDevSupporters', () => {
  it('is deterministic', () => {
    expect(generateDevSupporters(pus, leads)).toEqual({ supporters, patterns })
  })

  it('makes valid records: UUIDv7 ids, consent, fake phones, PU leads by state', () => {
    expect(supporters).toHaveLength(DEV_SUPPORTER_COUNT)
    expect(new Set(supporters.map(s => s.id)).size).toBe(DEV_SUPPORTER_COUNT)
    for (const s of supporters) {
      expect(isUuidV7(s.id)).toBe(true)
      expect(s.consentAt).toBeInstanceOf(Date)
      expect(s.consentVersion).toBe(`c1-${s.consentLanguage}`)
      expect(s.capturedBy).toBe(s.puCode.startsWith('19/') ? 'lead-kano' : 'lead-katsina')
      if (s.status === 'anonymised') expect([s.phone, s.address, s.gps]).toEqual([null, null, null])
      else expect(s.phone!.startsWith(DEV_SUPPORTER_PHONE_PREFIX)).toBe(true)
    }
  })

  it('never includes sensitive fields', () => {
    const keys = new Set(supporters.flatMap(s => Object.keys(s)))
    for (const k of keys) expect(k).not.toMatch(/pvcNumber|vin|nin|bvn|religion|ethnic/i)
  })

  it('plants a PU over 90% of its registered voters, with an 80-capture burst in one hour', () => {
    const pu = pus.find(p => p.code === patterns.overCapacityPu)!
    const onPu = supporters.filter(s => s.puCode === pu.code)
    expect(onPu.length).toBeGreaterThan(pu.registeredVoters * 0.9)
    const times = onPu.map(s => s.capturedAt.getTime()).sort((a, b) => a - b)
    const maxInHour = Math.max(...times.map(t => times.filter(u => u >= t && u < t + 3_600_000).length))
    expect(maxInHour).toBeGreaterThanOrEqual(patterns.burstCount)
  })

  it('plants a GPS cluster, far fixes and duplicate phones (max 3 per number)', () => {
    const cluster = supporters.filter(s => s.puCode === patterns.clusterPu && s.gps)
    const byFix = new Map<string, number>()
    for (const s of cluster) byFix.set(JSON.stringify(s.gps), (byFix.get(JSON.stringify(s.gps)) ?? 0) + 1)
    expect(Math.max(...byFix.values())).toBe(patterns.clusterCount)

    expect(patterns.farIds).toHaveLength(40)
    for (const id of patterns.farIds) {
      const s = supporters.find(x => x.id === id)!
      expect(km(s.gps!, pus.find(p => p.code === s.puCode)!.location)).toBeGreaterThan(4)
    }

    const perPhone = new Map<string, number>()
    for (const s of supporters) if (s.phone) perPhone.set(s.phone, (perPhone.get(s.phone) ?? 0) + 1)
    expect(Math.max(...perPhone.values())).toBe(3)
    expect(patterns.duplicatePhones.every(p => perPhone.get(p)! >= 2)).toBe(true)
    expect(supporters.filter(s => s.sharedPhone)).toHaveLength(30)
  })
})
