import type { UnitLevel } from './enums'

export const ROLES = ['ADMIN', 'DG', 'STATE_LEAD', 'LGA_LEAD', 'WARD_LEAD', 'PU_LEAD'] as const
export type Role = typeof ROLES[number]

/** Unit level a role is attached to. `null` = region-wide (no unit_code). */
export const ROLE_LEVEL: Record<Role, UnitLevel | null> = {
  ADMIN: null,
  DG: null,
  STATE_LEAD: 'state',
  LGA_LEAD: 'lga',
  WARD_LEAD: 'ward',
  PU_LEAD: 'pu',
}

/** The only role each role may invite/deactivate (SECURITY_PRIVACY §3). PU leads invite nobody. */
export const CHILD_ROLE: Record<Role, Role | null> = {
  ADMIN: 'DG',
  DG: 'STATE_LEAD',
  STATE_LEAD: 'LGA_LEAD',
  LGA_LEAD: 'WARD_LEAD',
  WARD_LEAD: 'PU_LEAD',
  PU_LEAD: null,
}

const LEAD_BY_LEVEL: Record<UnitLevel, Role> = {
  state: 'STATE_LEAD',
  lga: 'LGA_LEAD',
  ward: 'WARD_LEAD',
  pu: 'PU_LEAD',
}

/** The lead role for a unit level. */
export function roleForLevel(level: UnitLevel): Role {
  return LEAD_BY_LEVEL[level]
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}
