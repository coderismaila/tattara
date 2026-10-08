// Map maths (task 6.3, ARCHITECTURE §8, UX §3): colour classes per metric, legend labels, which boundary features to
// draw for a unit, and the breadcrumb. Pure and unit-tested; the map component only draws what these return.
import type { ChildMetric, ChildStats } from '~~/shared/types/stats'

/** Colour-blind-safe sequential ramp, light → dark (UX §3). */
export const MAP_RAMP = ['#F1EEF6', '#BDC9E1', '#74A9CF', '#2B8CBE', '#045A8D'] as const
/** Units without a value: drawn hatched grey. */
export const NO_DATA_COLOR = '#D4D4D4'
/** Coverage classes are fixed (ARCHITECTURE §8): 0–10, 10–25, 25–40, 40–60, 60%+. Lower bounds of classes 2–5. */
export const COVERAGE_BREAKS = [0.1, 0.25, 0.4, 0.6] as const

/** A metric's value for a unit, or null when it has none. */
export function metricValue(row: ChildStats, metric: ChildMetric): number | null {
  return metric === 'supporters' ? row.supporters : row[metric]
}

/**
 * Lower bounds of classes 2–5: fixed for coverage, otherwise quantiles of the values present (duplicates removed, so
 * fewer distinct values give fewer classes). Empty when no unit has a value.
 */
export function classBreaks(values: (number | null)[], metric: ChildMetric): number[] {
  if (metric === 'coverage') return [...COVERAGE_BREAKS]
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (!sorted.length) return []
  const breaks = [0.2, 0.4, 0.6, 0.8].map(q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!)
  return [...new Set(breaks)].filter(b => b > sorted[0]!)
}

/** Class 0–4 for a value (null → null: no data). */
export function classOf(value: number | null, breaks: number[]): number | null {
  if (value === null) return null
  let c = 0
  for (const b of breaks) if (value >= b) c++
  return Math.min(c, MAP_RAMP.length - 1)
}

export function colorOf(value: number | null, breaks: number[]): string {
  const c = classOf(value, breaks)
  return c === null ? NO_DATA_COLOR : MAP_RAMP[c]!
}

/** Legend rows: colour and the range it stands for, formatted by the caller's `format`. */
export function legendRows(breaks: number[], format: (v: number) => string): { color: string, from: string, to: string | null }[] {
  const bounds = [0, ...breaks]
  return bounds.map((from, i) => ({
    color: MAP_RAMP[i]!,
    from: format(from),
    to: i + 1 < bounds.length ? format(bounds[i + 1]!) : null,
  }))
}

export type MapLevel = 'region' | 'state' | 'lga' | 'ward'

/** What the map shows inside a unit: its children's boundaries, or PU points inside a ward. */
export function childLayer(code: string): { kind: 'states' | 'lgas' | 'wards' | 'pus', file: string | null } {
  const level = code === '' ? 'region' : code.length === 2 ? 'state' : code.length === 5 ? 'lga' : 'ward'
  switch (level) {
    case 'region': return { kind: 'states', file: '/geo/nw-states.geojson' }
    case 'state': return { kind: 'lgas', file: '/geo/nw-lgas.geojson' }
    case 'lga': return { kind: 'wards', file: `/geo/wards/${code.slice(0, 2)}.geojson` }
    default: return { kind: 'pus', file: null }
  }
}

/** Boundary features that are direct children of `code` ('' = states). */
export function featuresUnder<F extends { properties: { code?: unknown } | null }>(features: F[], code: string): F[] {
  const depth = code === '' ? 2 : code.length + 3
  return features.filter((f) => {
    const c = f.properties?.code
    return typeof c === 'string' && c.length === depth && (code === '' || c.startsWith(`${code}/`))
  })
}

/**
 * The breadcrumb from the caller's top unit down to `code`: each ancestor the caller may open. `scope` '' = region.
 * Names come from `names` (code → name), the region from `regionName`.
 */
export function breadcrumb(code: string, scope: string, names: Record<string, string>, regionName: string): { code: string, name: string }[] {
  const chain = ['']
  for (const len of [2, 5, 8]) if (code.length >= len) chain.push(code.slice(0, len))
  return chain
    .filter(c => scope === '' || c === scope || c.startsWith(`${scope}/`))
    .map(c => ({ code: c, name: c === '' ? regionName : names[c] ?? c }))
}
