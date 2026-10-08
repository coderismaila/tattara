// Lead quality score (PRD R-7, task 5.5, ADR-044): one 0–100 number per unit from its supporters' verified rate, flag
// rate and opt-out rate (plus the call-back pass rate when there are enough calls). Pure, shared by the nightly job
// and its tests.

/** Supporters captured within this many days count. */
export const QUALITY_WINDOW_DAYS = 90
/** Fewer supporters than this: no score yet (too little data to judge). */
export const QUALITY_MIN_SUPPORTERS = 10
/** Answered call-backs needed before the pass rate counts. */
export const QUALITY_MIN_CALLS = 5
/** At this share (or more) of flagged or opted-out records, that part of the score is zero. */
const RATE_FOR_ZERO = 0.25

export interface QualityCounts {
  supporters: number
  /** Thank-you delivered or call-back verified. */
  verified: number
  /** Open or confirmed flags (dismissed ones don't count). */
  flags: number
  optedOut: number
  /** Answered call-backs: verified vs wrong number / denies. */
  callsVerified: number
  callsFailed: number
}

export interface Quality {
  /** 0–100, or null with fewer than QUALITY_MIN_SUPPORTERS supporters. */
  score: number | null
  verifiedRate: number
  flagRate: number
  optOutRate: number
  /** null with fewer than QUALITY_MIN_CALLS answered calls. */
  passRate: number | null
  supporters: number
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : 0)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function qualityScore(c: QualityCounts): Quality {
  const verifiedRate = clamp01(ratio(c.verified, c.supporters))
  const flagRate = ratio(c.flags, c.supporters)
  const optOutRate = clamp01(ratio(c.optedOut, c.supporters))
  const answered = c.callsVerified + c.callsFailed
  const passRate = answered >= QUALITY_MIN_CALLS ? ratio(c.callsVerified, answered) : null

  const verifiedPart = passRate === null ? verifiedRate : (verifiedRate + passRate) / 2
  const flagPart = 1 - clamp01(flagRate / RATE_FOR_ZERO)
  const optOutPart = 1 - clamp01(optOutRate / RATE_FOR_ZERO)
  const score = c.supporters < QUALITY_MIN_SUPPORTERS
    ? null
    : Math.round(100 * (0.5 * verifiedPart + 0.25 * flagPart + 0.25 * optOutPart))

  return { score, verifiedRate, flagRate, optOutRate, passRate, supporters: c.supporters }
}

/** The units a PU's numbers roll up into: the PU, its ward, LGA and state (`SS/LL/WW/PPP`). */
export function rollUpCodes(puCode: string): string[] {
  return [puCode, puCode.slice(0, 8), puCode.slice(0, 5), puCode.slice(0, 2)]
}
