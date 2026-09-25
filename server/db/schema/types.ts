import { sql } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'
import { parseEwkbPoint, type LngLat } from '../geo.ts'

/** `geography(Point, 4326)`: WGS84 lon/lat with metre-based distance functions. */
export const geographyPoint = customType<{ data: LngLat, driverData: string }>({
  dataType() {
    return 'geography(Point, 4326)'
  },
  toDriver(value) {
    return sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)::geography`
  },
  fromDriver(value) {
    return parseEwkbPoint(value)
  },
})
