import { describe, expect, it } from 'vitest'
import { UNIT_LEVELS } from '../../shared/constants/enums'
import type { ROLES } from '../../shared/constants/roles'
import { CHILD_ROLE, ROLE_LEVEL, isRole, roleForLevel } from '../../shared/constants/roles'
import { NW_STATES, isNwStateCode } from '../../shared/constants/states'
import { parsePuCode } from '../../shared/utils/pu-code'

describe('roles', () => {
  it('invite chain runs ADMIN → DG → STATE → LGA → WARD → PU and stops', () => {
    const chain: string[] = []
    let role: typeof ROLES[number] | null = 'ADMIN'
    while (role) {
      chain.push(role)
      role = CHILD_ROLE[role]
    }
    expect(chain).toEqual(['ADMIN', 'DG', 'STATE_LEAD', 'LGA_LEAD', 'WARD_LEAD', 'PU_LEAD'])
  })

  it('each lead invites exactly one level down', () => {
    for (const level of UNIT_LEVELS.slice(0, -1)) {
      const child = CHILD_ROLE[roleForLevel(level)]!
      const childLevel = ROLE_LEVEL[child]!
      expect(UNIT_LEVELS.indexOf(childLevel)).toBe(UNIT_LEVELS.indexOf(level) + 1)
    }
  })

  it('maps levels to lead roles and back', () => {
    for (const level of UNIT_LEVELS) {
      expect(ROLE_LEVEL[roleForLevel(level)]).toBe(level)
    }
    expect(ROLE_LEVEL.DG).toBeNull()
    expect(ROLE_LEVEL.ADMIN).toBeNull()
  })

  it('guards role strings', () => {
    expect(isRole('WARD_LEAD')).toBe(true)
    expect(isRole('ward_lead')).toBe(false)
    expect(isRole(undefined)).toBe(false)
  })
})

describe('NW states', () => {
  it('lists the 7 North West states with unique, valid state codes', () => {
    expect(NW_STATES).toHaveLength(7)
    const codes = NW_STATES.map(s => s.code)
    expect(new Set(codes).size).toBe(7)
    for (const code of codes) {
      expect(parsePuCode(code)?.level).toBe('state')
    }
    expect(NW_STATES.find(s => s.code === '19')?.name).toBe('Kano')
  })

  it('recognises only NW state codes', () => {
    expect(isNwStateCode('36')).toBe(true)
    expect(isNwStateCode('24')).toBe(false) // Lagos
    expect(isNwStateCode('19/05')).toBe(false)
  })
})
