// Deterministic FAKE geography for development (SEED_DATA §5): 2 states (Kano, Katsina) × 3 LGAs × 4 wards × 10 PUs.
// Pure: no DB access. Real state codes, fake everything below.
import type { UnitLevel } from '../../shared/constants/enums.ts'
import { NW_STATES } from '../../shared/constants/states.ts'
import { formatPuCode } from '../../shared/utils/pu-code.ts'
import { normaliseName } from '../../shared/utils/text.ts'
import { LGA_NAMES, PU_PLACES, WARD_NAMES } from '../fixtures/places.ts'

export const DEV_SOURCE_VERSION = 'dev-fake'

export const DEV_SHAPE = { lgasPerState: 3, wardsPerLga: 4, pusPerWard: 10 } as const

/** Dev states and their approximate capitals (lng, lat), which anchor the fake geography. */
export const DEV_STATES = [
  { code: '19', anchor: { lng: 8.52, lat: 12.0 } }, // Kano
  { code: '20', anchor: { lng: 7.6, lat: 12.99 } }, // Katsina
] as const

/** Share of registered voters used as the dev target at ward level. */
const TARGET_SHARE = 0.3

export interface DevUnit {
  code: string
  level: UnitLevel
  parentCode: string | null
  name: string
  nameNormalised: string
  registeredVoters: number
  location: { lng: number, lat: number }
  sourceVersion: string
}

export interface DevTarget {
  unitCode: string
  target: number
}

export interface DevGeography {
  units: DevUnit[]
  targets: DevTarget[]
}

/** mulberry32: tiny seeded PRNG so every run produces identical data. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export function generateDevGeography(seed = 20260925): DevGeography {
  const rand = prng(seed)
  const between = (min: number, max: number) => min + rand() * (max - min)
  const jitter = (p: { lng: number, lat: number }, deg: number) => ({
    lng: round6(p.lng + between(-deg, deg)),
    lat: round6(p.lat + between(-deg, deg)),
  })

  const units: DevUnit[] = []
  const make = (code: string, level: UnitLevel, parentCode: string | null, name: string, location: DevUnit['location']): DevUnit => {
    const u: DevUnit = {
      code,
      level,
      parentCode,
      name,
      nameNormalised: normaliseName(name),
      registeredVoters: 0,
      location,
      sourceVersion: DEV_SOURCE_VERSION,
    }
    units.push(u)
    return u
  }

  let wardNameIdx = 0
  for (const { code, anchor } of DEV_STATES) {
    const state = NW_STATES.find(st => st.code === code)!
    const s = make(state.code, 'state', null, state.name.toUpperCase(), anchor)

    for (let l = 1; l <= DEV_SHAPE.lgasPerState; l++) {
      const lgaCode = formatPuCode({ state: state.code, lga: l })
      const lga = make(lgaCode, 'lga', s.code, `${s.name} ${LGA_NAMES[l - 1]}`, jitter(anchor, 0.4))

      for (let w = 1; w <= DEV_SHAPE.wardsPerLga; w++) {
        const wardCode = formatPuCode({ state: state.code, lga: l, ward: w })
        const wardName = WARD_NAMES[wardNameIdx++ % WARD_NAMES.length]!
        const ward = make(wardCode, 'ward', lga.code, wardName, jitter(lga.location, 0.08))

        for (let p = 1; p <= DEV_SHAPE.pusPerWard; p++) {
          const puCode = formatPuCode({ state: state.code, lga: l, ward: w, pu: p })
          // ~0.008° ≈ 0.9 km: PUs sit close to their ward centre.
          const pu = make(puCode, 'pu', ward.code, `${wardName} ${PU_PLACES[p - 1]}`, jitter(ward.location, 0.008))
          pu.registeredVoters = Math.round(between(300, 1200))
          ward.registeredVoters += pu.registeredVoters
        }
        lga.registeredVoters += ward.registeredVoters
      }
      s.registeredVoters += lga.registeredVoters
    }
  }

  // Targets: 30% of registered voters per ward; LGA and state targets are the sums.
  const targetByCode = new Map<string, number>()
  for (const u of units.filter(u => u.level === 'ward')) {
    targetByCode.set(u.code, Math.round(u.registeredVoters * TARGET_SHARE))
  }
  for (const level of ['lga', 'state'] as const) {
    for (const u of units.filter(u => u.level === level)) {
      const sum = units
        .filter(c => c.parentCode === u.code)
        .reduce((acc, c) => acc + (targetByCode.get(c.code) ?? 0), 0)
      targetByCode.set(u.code, sum)
    }
  }

  const targets = units
    .filter(u => targetByCode.has(u.code))
    .map(u => ({ unitCode: u.code, target: targetByCode.get(u.code)! }))

  return { units, targets }
}
