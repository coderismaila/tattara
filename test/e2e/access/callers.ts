// Who calls the API in the access-control suite (SECURITY_PRIVACY §4, task 3.6): signed out, the admin, the DG, and
// the seeded Kano chain (in scope for the fixtures) with its Katsina counterpart (out of scope).
import { ROOT } from '../support/env'

export const CALLERS = [
  'anon',
  'admin',
  'dg',
  'kanoState',
  'kanoLga',
  'kanoWard',
  'kanoPu',
  'katsinaState',
  'katsinaLga',
  'katsinaWard',
  'katsinaPu',
] as const
export type Caller = typeof CALLERS[number]

/** Seeded dev users (scripts/seed/dev-users.ts), local format for the login form. */
export const CALLER_PHONE: Record<Exclude<Caller, 'anon'>, string> = {
  admin: '08000000001',
  dg: '08000000002',
  kanoState: '08000000101',
  kanoLga: '08000000102',
  kanoWard: '08000000103', // 19/01/01
  kanoPu: '08000000104', // 19/01/01/001
  katsinaState: '08000000201',
  katsinaLga: '08000000202',
  katsinaWard: '08000000203', // 20/01/01
  katsinaPu: '08000000204', // 20/01/01/001
}

export const callerStateFile = (caller: Exclude<Caller, 'anon'>) => `${ROOT}test-results/access/${caller}.json`
export const ACCESS_FIXTURE_FILE = `${ROOT}test-results/access/fixture.json`
