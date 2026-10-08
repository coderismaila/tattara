// GET /api/geo/pus (API.md, task 6.3) and the bits of GeoJSON the map uses.

export interface PuPoint {
  code: string
  name: string
  lat: number
  lng: number
  /** The location is a stand-in (ward centroid or polygon point), not INEC's PU coordinate. */
  locationEstimated: boolean
  total: number
  coverage: number | null
}

export interface PuPointsResponse {
  ward: string
  points: PuPoint[]
}

export interface GeoFeature<P = Record<string, unknown>> {
  type: 'Feature'
  geometry: { type: string, coordinates: unknown }
  properties: P | null
}

export interface GeoFeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: GeoFeature<P>[]
}
