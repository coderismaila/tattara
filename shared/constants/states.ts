// The 7 North West states with INEC state codes (PRD §3). Verified again by the INEC importer (task 1.4).
export const NW_STATES = [
  { code: '17', name: 'Jigawa', slug: 'jigawa' },
  { code: '18', name: 'Kaduna', slug: 'kaduna' },
  { code: '19', name: 'Kano', slug: 'kano' },
  { code: '20', name: 'Katsina', slug: 'katsina' },
  { code: '21', name: 'Kebbi', slug: 'kebbi' },
  { code: '33', name: 'Sokoto', slug: 'sokoto' },
  { code: '36', name: 'Zamfara', slug: 'zamfara' },
] as const

export type NwState = typeof NW_STATES[number]
export type NwStateCode = NwState['code']

export const NW_STATE_CODES: readonly NwStateCode[] = NW_STATES.map(s => s.code)

export function isNwStateCode(code: string): code is NwStateCode {
  return (NW_STATE_CODES as readonly string[]).includes(code)
}
