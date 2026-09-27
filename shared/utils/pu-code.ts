// INEC unit codes `SS/LL/WW/PPP` are the hierarchy and the authorisation scope (ARCHITECTURE §4, ADR-002).
// Names are prefixed because Nuxt auto-imports shared/utils into the app.
import type { UnitLevel } from '../constants/enums'

export interface PuCodeParts {
  state: string
  lga?: string
  ward?: string
  pu?: string
}

export interface ParsedPuCode extends PuCodeParts {
  code: string
  level: UnitLevel
}

const LEVELS_BY_DEPTH: readonly UnitLevel[] = ['state', 'lga', 'ward', 'pu']
// Zero-padded exactly as INEC publishes: state 2, LGA 2, ward 2, PU 3 digits.
const CODE_RE = /^(\d{2})(?:\/(\d{2})(?:\/(\d{2})(?:\/(\d{3}))?)?)?$/

/** Parse a unit code at any level. Returns `null` unless the code is strictly well-formed. */
export function parsePuCode(code: string): ParsedPuCode | null {
  const m = CODE_RE.exec(code)
  if (!m) return null
  const [, state, lga, ward, pu] = m
  const depth = [state, lga, ward, pu].filter(Boolean).length
  return {
    code,
    level: LEVELS_BY_DEPTH[depth - 1]!,
    state: state!,
    ...(lga && { lga }),
    ...(ward && { ward }),
    ...(pu && { pu }),
  }
}

export function isValidPuCode(code: string): boolean {
  return CODE_RE.test(code)
}

/**
 * Build a code from numeric or string parts, zero-padding each segment.
 * Throws if a later segment is given without the ones before it, or a segment doesn't fit.
 */
export function formatPuCode(parts: { state: string | number, lga?: string | number, ward?: string | number, pu?: string | number }): string {
  const segments: Array<[string | number | undefined, number]> = [
    [parts.state, 2],
    [parts.lga, 2],
    [parts.ward, 2],
    [parts.pu, 3],
  ]
  const out: string[] = []
  let ended = false
  for (const [value, width] of segments) {
    if (value === undefined || value === '') {
      ended = true
      continue
    }
    if (ended) throw new Error('formatPuCode: segment given without its parent segments')
    const s = String(value).padStart(width, '0')
    if (!new RegExp(`^\\d{${width}}$`).test(s)) {
      throw new Error(`formatPuCode: invalid segment "${value}"`)
    }
    out.push(s)
  }
  return out.join('/')
}

/** Level of a code, or `null` if malformed. */
export function unitLevel(code: string): UnitLevel | null {
  return parsePuCode(code)?.level ?? null
}

/** Parent unit code; `''` (region) for a state; `null` if malformed. */
export function parentCode(code: string): string | null {
  if (!isValidPuCode(code)) return null
  const i = code.lastIndexOf('/')
  return i === -1 ? '' : code.slice(0, i)
}

/** Ancestor codes from state down to (excluding) the code itself. */
export function ancestorCodes(code: string): string[] {
  if (!isValidPuCode(code)) return []
  const segs = code.split('/')
  return segs.slice(0, -1).map((_, i) => segs.slice(0, i + 1).join('/'))
}

/** SQL LIKE-style prefix for descendants of a scope unit: `''` for region, else `code + '/'`. */
export function scopePrefix(scopeUnitCode: string): string {
  return scopeUnitCode === '' ? '' : `${scopeUnitCode}/`
}

/**
 * Is `code` the scope unit itself or inside it?
 * `scopeUnitCode` is a unit code (`''` = region/DG), never a raw prefix, so `19` can't match `190/…`.
 */
export function isWithin(code: string, scopeUnitCode: string): boolean {
  if (!isValidPuCode(code)) return false
  if (scopeUnitCode === '') return true
  if (!isValidPuCode(scopeUnitCode)) return false
  return code === scopeUnitCode || code.startsWith(scopePrefix(scopeUnitCode))
}

/** The region as a whole in URLs (`/api/units/all/…`), for DG/admin aggregates. */
export const REGION_URL_CODE = 'all'

/**
 * A unit code for a URL path segment: `19/05/03` → `19-05-03` (codes are digits and slashes only). `''` (region) →
 * `all`. Round-trips with `fromUrlCode`.
 */
export function toUrlCode(code: string): string {
  return code === '' ? REGION_URL_CODE : code.replaceAll('/', '-')
}

/** The unit code from a URL segment, `''` for the region, or null when it isn't a valid code. */
export function fromUrlCode(segment: string | undefined): string | null {
  if (segment === REGION_URL_CODE) return ''
  if (!segment || !/^[\d-]+$/.test(segment)) return null
  const code = segment.replaceAll('-', '/')
  return isValidPuCode(code) ? code : null
}
