import { describe, expect, it } from 'vitest'
import { normaliseName } from '../../shared/utils/text'

describe('normaliseName', () => {
  it.each([
    ['KANO MUNICIPAL', 'kano municipal'],
    ['Ƙofar-Mata (Gabas)', 'kofar mata gabas'],
    ['ƊAN ƁAURE', 'dan baure'],
    ['Ƴan Awaki', 'yan awaki'],
    ['Birnin  Kebbi', 'birnin kebbi'],
    ['Dan\'Agundi', 'danagundi'],
    ['Dan’Agundi', 'danagundi'],
    ['Zaria  /  Sabon Gari.', 'zaria sabon gari'],
    ['Sokoto North 002', 'sokoto north 002'],
    ['Café Wurno', 'cafe wurno'],
    ['  ', ''],
  ])('%j → %j', (input, expected) => {
    expect(normaliseName(input)).toBe(expected)
  })

  it('makes hooked and plain spellings match', () => {
    expect(normaliseName('Ƙaura Namoda')).toBe(normaliseName('Kaura Namoda'))
  })
})
