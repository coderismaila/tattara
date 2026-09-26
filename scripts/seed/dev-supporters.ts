// Deterministic FAKE supporters for development (task 3.1): ~5,000 across the dev PUs, with planted patterns the
// flag engine (5.1) must find. Pure: no DB access. Names are random Hausa combinations; phones are in a fake range.
import type { LngLat } from '../../server/db/geo.ts'
import type { NewSupporter } from '../../server/db/schema/index.ts'
import { AGE_BANDS, type VerificationStatus } from '../../shared/constants/enums.ts'
import { FAMILY_NAMES, FEMALE_NAMES, LANDMARKS, MALE_NAMES } from '../fixtures/names.ts'
import { prng } from './dev-geography.ts'

export const DEV_SUPPORTER_COUNT = 5000
/** Fake supporter phones: +234 800 01x xxxx (dev users use +234 800 000 xxxx). */
export const DEV_SUPPORTER_PHONE_PREFIX = '+23480001'
/** Captures are spread over the 25 days from here (fixed, so every run is identical). */
const BASE_MS = Date.UTC(2026, 8, 1, 7) // 1 Sep 2026, 08:00 WAT
const DAY_MS = 24 * 60 * 60 * 1000

export interface DevPu {
  code: string
  location: LngLat
  registeredVoters: number
}

/** The planted patterns, for tests and for 5.1's fixtures. */
export interface DevSupporterPatterns {
  /** PU whose supporter count exceeds 90% of its registered voters (pu_over_capacity). */
  overCapacityPu: string
  /** 80 captures within one hour on this PU by one lead (rate_anomaly). */
  burstPu: string
  burstCount: number
  /** 25 supporters sharing one identical GPS fix (gps_cluster). */
  clusterPu: string
  clusterCount: number
  /** Supporters captured 5–15 km from their PU (gps_far). */
  farIds: string[]
  /** Phones used by 2 (pairs) or 3 (shared-phone triples) supporters (duplicate_phone). */
  duplicatePhones: string[]
}

export interface DevSupporters {
  supporters: (NewSupporter & { id: string, gps: LngLat | null })[]
  patterns: DevSupporterPatterns
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * @param pus the dev PUs (with location and registered voters)
 * @param leadByState user id credited with each state's captures (the dev PUs have no leads of their own)
 */
export function generateDevSupporters(pus: readonly DevPu[], leadByState: Readonly<Record<string, string>>, seed = 20260926): DevSupporters {
  const rand = prng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
  const hex = (digits: number) => Array.from({ length: digits }, () => Math.floor(rand() * 16).toString(16)).join('')
  /** A UUIDv7 for `ms` with seeded random bits. */
  const uuidV7 = (ms: number) => {
    const t = ms.toString(16).padStart(12, '0')
    return `${t.slice(0, 8)}-${t.slice(8)}-7${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`
  }
  const weighted = <T extends string>(table: readonly [T, number][]): T => {
    let r = rand()
    for (const [value, p] of table) {
      if ((r -= p) < 0) return value
    }
    return table[table.length - 1]![0]
  }

  const sorted = [...pus].sort((a, b) => a.code.localeCompare(b.code))
  const overCapacity = sorted.reduce((min, p) => (p.registeredVoters < min.registeredVoters ? p : min))
  const cluster = sorted.find(p => p.code !== overCapacity.code && p.code.endsWith('/005'))!
  const overCount = Math.ceil(overCapacity.registeredVoters * 0.92)
  const others = sorted.filter(p => p.code !== overCapacity.code)
  const CLUSTER_SIZE = 25

  // PU for each record: the over-capacity PU, the cluster's 25, then the rest spread randomly.
  const puFor: DevPu[] = [
    ...Array.from({ length: overCount }, () => overCapacity),
    ...Array.from({ length: CLUSTER_SIZE }, () => cluster),
    ...Array.from({ length: DEV_SUPPORTER_COUNT - overCount - CLUSTER_SIZE }, () => pick(others)),
  ]

  const clusterFix = { lng: round6(cluster.location.lng + 0.001), lat: round6(cluster.location.lat + 0.001) }
  let clusterLeft = CLUSTER_SIZE
  let burstLeft = 80
  const burstStart = BASE_MS + 10 * DAY_MS + 2 * 60 * 60 * 1000

  const supporters = puFor.map((pu, i): DevSupporters['supporters'][number] => {
    const state = pu.code.slice(0, 2)
    const inBurst = pu === overCapacity && burstLeft > 0 && burstLeft-- > 0
    const capturedMs = inBurst
      ? burstStart + (80 - burstLeft) * 40_000 // one every 40 s
      : BASE_MS + Math.floor(rand() * 25) * DAY_MS + Math.floor(rand() * 10 * 60 * 60 * 1000)
    const female = rand() < 0.45
    const inCluster = pu === cluster && clusterLeft > 0 && clusterLeft-- > 0
    const gps: LngLat | null = inCluster
      ? clusterFix
      : rand() < 0.1 ? null : { lng: round6(pu.location.lng + (rand() - 0.5) * 0.006), lat: round6(pu.location.lat + (rand() - 0.5) * 0.006) }
    const language = rand() < 0.85 ? 'ha' as const : 'en' as const
    const capturedAt = new Date(capturedMs)
    return {
      id: uuidV7(capturedMs),
      puCode: pu.code,
      fullName: `${pick(female ? FEMALE_NAMES : MALE_NAMES)} ${pick(FAMILY_NAMES)}`,
      phone: `${DEV_SUPPORTER_PHONE_PREFIX}${String(i).padStart(5, '0')}`,
      sharedPhone: false,
      address: rand() < 0.7 ? pick(LANDMARKS) : null,
      gender: female ? 'female' : 'male',
      ageBand: rand() < 0.05 ? null : pick(AGE_BANDS),
      supportLevel: weighted([['strong', 0.6], ['leaning', 0.28], ['undecided', 0.12]]),
      hasPvc: weighted([['yes', 0.75], ['no', 0.15], ['unsure', 0.1]]),
      volunteer: rand() < 0.12,
      consentAt: capturedAt,
      consentVersion: `c1-${language}`,
      consentLanguage: language,
      gps,
      gpsAccuracyM: gps ? 5 + Math.floor(rand() * 55) : null,
      capturedAt,
      capturedBy: leadByState[state]!,
      deviceId: `dev-device-${state}`,
      verification: weighted<VerificationStatus>([['sms_delivered', 0.55], ['unverified', 0.3], ['callback_verified', 0.08], ['callback_failed', 0.02], ['opted_out', 0.05]]),
      status: 'active',
    }
  })

  // Plant the remaining patterns on records outside the over-capacity and cluster PUs.
  const candidates = supporters.filter(s => s.puCode !== overCapacity.code && s.puCode !== cluster.code && s.gps)
  const shuffled = candidates.map(s => ({ s, k: rand() })).sort((a, b) => a.k - b.k).map(x => x.s)
  let next = 0
  const take = () => shuffled[next++]!

  const farIds: string[] = []
  for (let n = 0; n < 40; n++) {
    const s = take()
    const km = 5 + rand() * 10
    const angle = rand() * 2 * Math.PI
    s.gps = { lng: round6(s.gps!.lng + (km / 111) * Math.cos(angle)), lat: round6(s.gps!.lat + (km / 111) * Math.sin(angle)) }
    farIds.push(s.id)
  }

  const duplicatePhones: string[] = []
  for (const size of [...Array.from({ length: 30 }, () => 2), ...Array.from({ length: 10 }, () => 3)]) {
    const group = Array.from({ length: size }, take)
    for (const s of group) {
      s.phone = group[0]!.phone
      s.sharedPhone = size === 3
    }
    duplicatePhones.push(group[0]!.phone!)
  }

  // A few removal requests and anonymised opt-outs.
  for (let n = 0; n < 10; n++) take().status = 'removal_requested'
  for (let n = 0; n < 8; n++) {
    Object.assign(take(), { status: 'anonymised', verification: 'opted_out', fullName: '—', phone: null, address: null, gps: null, gpsAccuracyM: null })
  }

  return {
    supporters,
    patterns: {
      overCapacityPu: overCapacity.code,
      burstPu: overCapacity.code,
      burstCount: 80,
      clusterPu: cluster.code,
      clusterCount: CLUSTER_SIZE,
      farIds,
      duplicatePhones,
    },
  }
}
