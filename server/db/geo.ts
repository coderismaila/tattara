// PostGIS helpers with no runtime dependencies (shared by Drizzle column types, scripts and tests).

export interface LngLat {
  lng: number
  lat: number
}

const EWKB_SRID_FLAG = 0x20000000
const WKB_POINT = 1

/**
 * Parse a PostGIS (E)WKB hex point, as returned for `geography(Point, 4326)` columns.
 * Throws on anything other than a 2D point.
 */
export function parseEwkbPoint(hex: string): LngLat {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('parseEwkbPoint: not a hex string')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  const view = new DataView(bytes.buffer)

  const littleEndian = view.getUint8(0) === 1
  const type = view.getUint32(1, littleEndian)
  let offset = 5
  if (type & EWKB_SRID_FLAG) offset += 4 // skip SRID
  if ((type & 0x0fffffff) !== WKB_POINT) {
    throw new Error('parseEwkbPoint: geometry is not a 2D point')
  }
  if (bytes.length !== offset + 16) {
    throw new Error('parseEwkbPoint: unexpected length')
  }
  return {
    lng: view.getFloat64(offset, littleEndian),
    lat: view.getFloat64(offset + 8, littleEndian),
  }
}
