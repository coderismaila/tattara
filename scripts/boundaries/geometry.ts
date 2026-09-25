// Minimal planar geometry helpers for GeoJSON Polygon/MultiPolygon (lng/lat). No dependencies.
import type { LngLat } from '../import/inec.ts'

type Ring = [number, number][]
export type PolygonCoords = Ring[]
export interface PolygonalGeometry {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: PolygonCoords | PolygonCoords[]
}

export interface BBox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

const polygons = (g: PolygonalGeometry): PolygonCoords[] =>
  g.type === 'Polygon' ? [g.coordinates as PolygonCoords] : g.coordinates as PolygonCoords[]

export function bboxOf(g: PolygonalGeometry): BBox {
  const b: BBox = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity }
  for (const poly of polygons(g)) {
    for (const [lng, lat] of poly[0] ?? []) {
      if (lng < b.minLng) b.minLng = lng
      if (lng > b.maxLng) b.maxLng = lng
      if (lat < b.minLat) b.minLat = lat
      if (lat > b.maxLat) b.maxLat = lat
    }
  }
  return b
}

export const inBBox = (p: LngLat, b: BBox) => p.lng >= b.minLng && p.lng <= b.maxLng && p.lat >= b.minLat && p.lat <= b.maxLat

/** Even-odd ray casting against one ring. */
function inRing(p: LngLat, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if ((yi > p.lat) !== (yj > p.lat) && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Point in Polygon/MultiPolygon, honouring holes. */
export function pointInGeometry(p: LngLat, g: PolygonalGeometry): boolean {
  return polygons(g).some(([outer, ...holes]) => !!outer && inRing(p, outer) && !holes.some(h => inRing(p, h)))
}
