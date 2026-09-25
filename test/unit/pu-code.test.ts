import { describe, expect, it } from 'vitest'
import {
  ancestorCodes,
  formatPuCode,
  isValidPuCode,
  isWithin,
  parentCode,
  parsePuCode,
  scopePrefix,
  unitLevel,
} from '../../shared/utils/pu-code'

describe('parsePuCode', () => {
  it.each([
    ['19', 'state', { state: '19' }],
    ['19/05', 'lga', { state: '19', lga: '05' }],
    ['19/05/03', 'ward', { state: '19', lga: '05', ward: '03' }],
    ['19/05/03/012', 'pu', { state: '19', lga: '05', ward: '03', pu: '012' }],
  ] as const)('parses %s as %s', (code, level, parts) => {
    expect(parsePuCode(code)).toEqual({ code, level, ...parts })
  })

  it.each([
    ['empty', ''],
    ['unpadded state', '9'],
    ['unpadded lga', '19/5'],
    ['unpadded pu', '19/05/03/12'],
    ['over-padded pu', '19/05/03/0012'],
    ['3-digit state', '190'],
    ['extra segment', '19/05/03/012/1'],
    ['trailing slash', '19/05/'],
    ['leading slash', '/19/05'],
    ['double slash', '19//05'],
    ['letters', '19/AB'],
    ['whitespace', ' 19/05'],
    ['other separator', '19-05'],
  ])('rejects %s (%j)', (_label, code) => {
    expect(parsePuCode(code)).toBeNull()
    expect(isValidPuCode(code)).toBe(false)
  })
})

describe('formatPuCode', () => {
  it('zero-pads each segment', () => {
    expect(formatPuCode({ state: 19 })).toBe('19')
    expect(formatPuCode({ state: 9, lga: 5, ward: 3, pu: 12 })).toBe('09/05/03/012')
    expect(formatPuCode({ state: '19', lga: '05', ward: '03', pu: '012' })).toBe('19/05/03/012')
  })

  it('round-trips with parsePuCode', () => {
    const code = '36/14/10/147'
    const p = parsePuCode(code)!
    expect(formatPuCode(p)).toBe(code)
  })

  it('throws on gaps and oversized or non-numeric segments', () => {
    expect(() => formatPuCode({ state: 19, ward: 3 })).toThrow()
    expect(() => formatPuCode({ state: 190 })).toThrow()
    expect(() => formatPuCode({ state: 19, lga: 'AB' })).toThrow()
    expect(() => formatPuCode({ state: 19, lga: 5, ward: 3, pu: 1000 })).toThrow()
  })
})

describe('unitLevel / parentCode / ancestorCodes', () => {
  it('derives levels', () => {
    expect(unitLevel('19')).toBe('state')
    expect(unitLevel('19/05/03/012')).toBe('pu')
    expect(unitLevel('nope')).toBeNull()
  })

  it('walks up to the region', () => {
    expect(parentCode('19/05/03/012')).toBe('19/05/03')
    expect(parentCode('19/05/03')).toBe('19/05')
    expect(parentCode('19/05')).toBe('19')
    expect(parentCode('19')).toBe('')
    expect(parentCode('19/5')).toBeNull()
  })

  it('lists ancestors top-down, excluding self', () => {
    expect(ancestorCodes('19/05/03/012')).toEqual(['19', '19/05', '19/05/03'])
    expect(ancestorCodes('19')).toEqual([])
    expect(ancestorCodes('bad')).toEqual([])
  })
})

describe('scope checks', () => {
  it('builds prefixes', () => {
    expect(scopePrefix('')).toBe('')
    expect(scopePrefix('19/05')).toBe('19/05/')
  })

  it('region scope (DG) contains every valid code', () => {
    expect(isWithin('19', '')).toBe(true)
    expect(isWithin('36/14/10/147', '')).toBe(true)
    expect(isWithin('garbage', '')).toBe(false)
  })

  it('includes the unit itself and its descendants', () => {
    expect(isWithin('19/05', '19/05')).toBe(true)
    expect(isWithin('19/05/03', '19/05')).toBe(true)
    expect(isWithin('19/05/03/012', '19/05')).toBe(true)
    expect(isWithin('19/05/03/012', '19')).toBe(true)
  })

  it('excludes siblings, parents and other states', () => {
    expect(isWithin('19/06/03/012', '19/05')).toBe(false)
    expect(isWithin('19', '19/05')).toBe(false)
    expect(isWithin('20/05/03/012', '19')).toBe(false)
  })

  it('is not fooled by string-prefix look-alikes', () => {
    // A naive startsWith('19/0') would leak 19/05 into a scope of "19/0".
    expect(isWithin('19/05/03', '19/0')).toBe(false)
    // A naive startsWith('1') would put Kano (19) inside "1".
    expect(isWithin('19/05', '1')).toBe(false)
    // PU scope with a longer sibling code.
    expect(isWithin('19/05/03/0123', '19/05/03/012')).toBe(false)
  })

  it('a PU lead scope contains only that PU', () => {
    expect(isWithin('19/05/03/012', '19/05/03/012')).toBe(true)
    expect(isWithin('19/05/03/013', '19/05/03/012')).toBe(false)
  })

  it('rejects a malformed scope unit instead of widening access', () => {
    expect(isWithin('19/05/03/012', '19/')).toBe(false)
    expect(isWithin('19/05/03/012', '/')).toBe(false)
  })
})
