import { describe, expect, it } from 'vitest'
import { parseLocatorRedirect, parseOptions } from '../../scripts/fetch/inec-pus'

describe('parseOptions (INEC locator option maps)', () => {
  it('parses code and name, skipping the placeholder and "selected"', () => {
    // Shape returned by /PublicApi/pus/1/Search (captured 2026-09-25).
    const payload = [{
      0: '--SELECT--',
      selected: '0',
      56771: '001 - DUGWAL, NEAR H/H HOUSE I',
      56774: '004 - MALIKAWA/ZARAWA, AJINGI YAMMA PS I',
    }]
    expect(parseOptions(payload)).toEqual([
      { id: '56771', code: '001', name: 'DUGWAL, NEAR H/H HOUSE I' },
      { id: '56774', code: '004', name: 'MALIKAWA/ZARAWA, AJINGI YAMMA PS I' },
    ])
  })

  it('collapses whitespace in names', () => {
    expect(parseOptions([{ 1: '02 -  BALARE   WARD ' }])).toEqual([{ id: '1', code: '02', name: 'BALARE WARD' }])
  })

  it('returns nothing for an empty result', () => {
    expect(parseOptions([{ 0: '-', selected: '0' }])).toEqual([])
  })

  it('throws on an unexpected label rather than guessing', () => {
    expect(() => parseOptions([{ 5: 'NO CODE HERE' }])).toThrow(/Unexpected option label/)
  })
})

describe('parseLocatorRedirect', () => {
  it('extracts lat/lng from the Google Maps redirect', () => {
    expect(parseLocatorRedirect('https://maps.google.com/?q=11.9663,9.0377&mra=pd&t=m&z=3')).toEqual({ lat: 11.9663, lng: 9.0377 })
  })

  it('returns null when there is no coordinate or it is 0,0', () => {
    expect(parseLocatorRedirect(null)).toBeNull()
    expect(parseLocatorRedirect('https://cvr.inecnigeria.org/pu')).toBeNull()
    expect(parseLocatorRedirect('https://maps.google.com/?q=0,0&z=3')).toBeNull()
  })
})
