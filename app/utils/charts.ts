// Geometry for the two small SVG charts on the home dashboards (task 6.2, ADR-046). No chart library: a trend line
// and a progress ring are a few lines of maths, far lighter than any library on a 2 GB phone. Pure, unit-tested.

export interface TrendPoint {
  day: string
  value: number
}

/**
 * An SVG path for `points` drawn in a `width` × `height` box with `pad` inside the edges. Days without a snapshot are
 * simply absent; the x axis is the point index (snapshots are daily). Empty → ''. One point → a short flat line.
 */
export function trendPath(points: TrendPoint[], width: number, height: number, pad = 2): string {
  if (!points.length) return ''
  const values = points.map(p => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => (points.length === 1 ? pad : pad + (i * (width - 2 * pad)) / (points.length - 1))
  const y = (v: number) => (max === min ? height / 2 : height - pad - ((v - min) * (height - 2 * pad)) / span)
  const coords = points.map((p, i) => `${round(x(i))} ${round(y(p.value))}`)
  if (points.length === 1) coords.push(`${round(width - pad)} ${round(y(points[0]!.value))}`)
  return `M${coords.join(' L')}`
}

/** How far round a progress ring to draw: the share done, clamped to 0–1 (over target still draws a full ring). */
export function ringFraction(value: number, target: number | null): number | null {
  if (!target || target <= 0) return null
  return Math.min(1, Math.max(0, value / target))
}

/** `stroke-dasharray` for a ring of radius `r` filled to `fraction`. */
export function ringDash(fraction: number, r: number): string {
  const c = 2 * Math.PI * r
  return `${round(c * fraction)} ${round(c)}`
}

const round = (n: number) => Math.round(n * 100) / 100
