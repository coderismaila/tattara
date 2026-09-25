// Name normalisation for matching and search (units.name_normalised, importers, supporter search).
const HAUSA_HOOKED: Record<string, string> = { ɓ: 'b', ɗ: 'd', ƙ: 'k', ƴ: 'y' }

/**
 * Lower-case, strip accents/apostrophes/punctuation, map Hausa hooked letters to plain ones,
 * collapse whitespace. `"Ƙofar-Mata (Gabas)"` → `"kofar mata gabas"`.
 */
export function normaliseName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ɓɗƙƴ]/g, c => HAUSA_HOOKED[c]!)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
