// Dev users (SEED_DATA §5): one active user per role on a Kano chain, plus a Katsina chain
// so scope tests have an out-of-scope counterpart. Dev only: every user has PIN 123456.
import type { Role } from '../../shared/constants/roles.ts'

export const DEV_PIN = '123456'

/** All dev phones share this prefix (`+234 800 000 xxxx`), which is how reset finds them. */
export const DEV_PHONE_PREFIX = '+234800000'

export interface DevUserSpec {
  key: string
  fullName: string
  phone: string
  role: Role
  unitCode: string | null
  /** key of the inviting dev user */
  invitedBy: string | null
}

const chain = (state: '19' | '20', label: string, phoneBlock: string, invitedBy: string): DevUserSpec[] => {
  const codes = [state, `${state}/01`, `${state}/01/01`, `${state}/01/01/001`]
  const roles: Role[] = ['STATE_LEAD', 'LGA_LEAD', 'WARD_LEAD', 'PU_LEAD']
  const names = ['State', 'LGA', 'Ward', 'PU']
  return roles.map((role, i) => ({
    key: `${label}-${role}`,
    fullName: `Dev ${label} ${names[i]} Lead`,
    phone: `${DEV_PHONE_PREFIX}${phoneBlock}${i + 1}`,
    role,
    unitCode: codes[i]!,
    invitedBy: i === 0 ? invitedBy : `${label}-${roles[i - 1]}`,
  }))
}

/** Ordered so every inviter comes before the users they invited. */
export const DEV_USERS: readonly DevUserSpec[] = [
  { key: 'ADMIN', fullName: 'Dev Admin', phone: `${DEV_PHONE_PREFIX}0001`, role: 'ADMIN', unitCode: null, invitedBy: null },
  { key: 'DG', fullName: 'Dev DG', phone: `${DEV_PHONE_PREFIX}0002`, role: 'DG', unitCode: null, invitedBy: 'ADMIN' },
  ...chain('19', 'Kano', '010', 'DG'),
  ...chain('20', 'Katsina', '020', 'DG'),
]
