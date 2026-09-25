import { describe, expect, it } from 'vitest'
import { parseEwkbPoint } from '../../server/db/geo'

// Fixtures produced by PostGIS 3.5 (ST_AsEWKB / ST_AsBinary / geography::text).
describe('parseEwkbPoint', () => {
  it('parses little-endian EWKB with SRID', () => {
    expect(parseEwkbPoint('0101000020e61000004a7b832f4c062140aa8251499d002840')).toEqual({ lng: 8.5123, lat: 12.0012 })
  })

  it('parses upper-case hex as returned for geography columns', () => {
    expect(parseEwkbPoint('0101000020E610000000000000000011C0AE47E17A14EE4B40')).toEqual({ lng: -4.25, lat: 55.86 })
  })

  it('parses big-endian WKB without SRID', () => {
    expect(parseEwkbPoint('00000000014021064c2f837b4a4028009d495182aa')).toEqual({ lng: 8.5123, lat: 12.0012 })
  })

  it('rejects non-point geometries', () => {
    const line = '0102000020e610000002000000000000000000f03f000000000000004000000000000008400000000000001040'
    expect(() => parseEwkbPoint(line)).toThrow(/not a 2D point/)
  })

  it('rejects malformed input', () => {
    expect(() => parseEwkbPoint('')).toThrow()
    expect(() => parseEwkbPoint('zz')).toThrow(/hex/)
    expect(() => parseEwkbPoint('0101000020e6100000')).toThrow(/length/)
  })
})
