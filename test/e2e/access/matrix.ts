// The access-control matrix (SECURITY_PRIVACY §4, task 3.6): for EVERY route under server/api, the status each caller
// gets, plus field checks. `expect` is a Record over all callers, so leaving one out is a type error, and a unit
// meta-test (test/unit/access-matrix.test.ts) fails when a route file has no entry here.
// Pure data + plain assertions: no Playwright imports, so the unit test can load it.
/* eslint-disable @typescript-eslint/no-explicit-any -- checks read untyped JSON responses and assert their shape at runtime */
import { newId } from '../../../shared/utils/uuid'
import type { Caller } from './callers'

/** Records created by access.setup.ts for the matrix (all in Kano, i.e. in scope for the Kano chain only). */
export interface AccessFixture {
  /** Supporter on 19/01/01/001: read and edited. */
  supporterView: string
  /** Supporters whose removal is requested by the Kano PU lead / ward lead (each once). */
  supporterRemovePu: string
  supporterRemoveWard: string
  /** Supporter that denied callers try to remove (never actually removed). */
  supporterOther: string
  /** Invited PU leads in 19/01/01 that the Kano ward lead deactivates / resets. */
  deactivateTarget: string
  resetTarget: string
}

export interface AccessRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
}

export interface AccessEntry {
  request: (fx: AccessFixture, caller: Caller) => AccessRequest
  /** Expected HTTP status for every caller. */
  expect: Record<Caller, number>
  /** Extra checks on a successful response. Throw to fail. */
  check?: (caller: Caller, body: any) => void
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const E164 = /^\+234\d{10}$/
const MASKED = /\*/

/** All denied except the listed callers (who get `allowed`); signed out is always 401. */
function only(allowed: Partial<Record<Caller, number>>, denied = 403): Record<Caller, number> {
  const all: Record<Caller, number> = {
    anon: 401, admin: denied, dg: denied, kanoState: denied, kanoLga: denied, kanoWard: denied, kanoPu: denied,
    katsinaState: denied, katsinaLga: denied, katsinaWard: denied, katsinaPu: denied,
  }
  return { ...all, ...allowed }
}

/** The same status for every caller, signed out included (public routes). */
const everyone = (status: number): Record<Caller, number> => ({
  anon: status, admin: status, dg: status, kanoState: status, kanoLga: status, kanoWard: status, kanoPu: status,
  katsinaState: status, katsinaLga: status, katsinaWard: status, katsinaPu: status,
})

const pushItem = (puCode: string) => {
  const now = new Date().toISOString()
  return {
    id: newId(), puCode, fullName: 'Access Test', phone: `+234803100${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`,
    supportLevel: 'strong', hasPvc: 'yes', consentAt: now, consentVersion: 'c1-ha', consentLanguage: 'ha', capturedAt: now,
    deviceId: '4b0c6d1e-2f3a-4b5c-8d7e-9f0a1b2c3d4e',
  }
}

export const ACCESS_MATRIX = {
  // ── Auth (public except me) ────────────────────────────────────────────────
  // Public routes: an empty body is a validation error for everyone, proving no session is needed or leaked.
  'POST /api/auth/login': { request: () => ({ method: 'POST', path: '/api/auth/login', body: {} }), expect: everyone(400) },
  'POST /api/auth/otp/verify': { request: () => ({ method: 'POST', path: '/api/auth/otp/verify', body: {} }), expect: everyone(400) },
  'POST /api/auth/otp/resend': { request: () => ({ method: 'POST', path: '/api/auth/otp/resend', body: {} }), expect: everyone(400) },
  'POST /api/auth/setup': { request: () => ({ method: 'POST', path: '/api/auth/setup', body: {} }), expect: everyone(400) },
  // Clears the cookie of this request's context only (each case gets a fresh context).
  'POST /api/auth/logout': { request: () => ({ method: 'POST', path: '/api/auth/logout' }), expect: everyone(200) },
  'GET /api/auth/me': {
    request: () => ({ method: 'GET', path: '/api/auth/me' }),
    expect: { ...everyone(200), anon: 401 },
    check: (_caller, body) => {
      ensure(!('phone' in body.user), 'me must not return the phone')
      ensure(typeof body.user.role === 'string', 'me returns the role')
    },
  },

  // ── Team (users below me) ──────────────────────────────────────────────────
  // A Kano LGA: its own lead manages it (full phones), the state lead and DG may browse it (masked), others 403.
  'GET /api/team': {
    request: () => ({ method: 'GET', path: '/api/team?unit=19/01' }),
    expect: only({ dg: 200, kanoState: 200, kanoLga: 200 }),
    check: (caller, body) => {
      const phones: string[] = body.members.filter((m: any) => m.lead).map((m: any) => m.lead.phone)
      ensure(phones.length > 0, 'the LGA has ward leads')
      if (caller === 'kanoLga') {
        ensure(body.canManage === true, 'own unit is manageable')
        ensure(phones.every(p => E164.test(p)), 'direct children: full phones')
      }
      else {
        ensure(body.canManage === false, 'a deeper unit is browse-only')
        ensure(phones.every(p => MASKED.test(p)), 'deeper leads: masked phones')
      }
    },
  },
  // Only a direct child unit: 19/01/01/008 is a PU of the Kano ward.
  'POST /api/team/invite': {
    request: () => ({ method: 'POST', path: '/api/team/invite', body: { unitCode: '19/01/01/008', fullName: 'Access Invitee', phone: '08031008008' } }),
    expect: only({ kanoWard: 200 }),
    check: (_caller, body) => ensure(!('token' in body), 'the invite token never leaves the server'),
  },
  'POST /api/team/:userId/deactivate': {
    request: fx => ({ method: 'POST', path: `/api/team/${fx.deactivateTarget}/deactivate`, body: { reason: 'Access suite' } }),
    expect: only({ kanoWard: 200 }),
  },
  'POST /api/team/:userId/reset-pin': {
    request: fx => ({ method: 'POST', path: `/api/team/${fx.resetTarget}/reset-pin` }),
    expect: only({ kanoWard: 200 }),
  },

  // ── Admin ──────────────────────────────────────────────────────────────────
  'GET /api/admin/dg': {
    request: () => ({ method: 'GET', path: '/api/admin/dg' }),
    expect: only({ admin: 200 }),
    check: (_caller, body) => ensure(MASKED.test(body.dg.phone), 'the DG phone is masked for the admin'),
  },
  // The seeded DG is active: without `replace` the admin gets 409 (reached the rule, changed nothing).
  'POST /api/admin/users/dg': {
    request: () => ({ method: 'POST', path: '/api/admin/users/dg', body: { fullName: 'Access DG', phone: '08031008099' } }),
    expect: only({ admin: 409 }),
  },

  // ── Supporters ─────────────────────────────────────────────────────────────
  'GET /api/supporters': {
    request: () => ({ method: 'GET', path: '/api/supporters?pu=19/01/01/001&limit=20' }),
    expect: only({ kanoWard: 200, kanoPu: 200 }),
    check: (_caller, body) => {
      ensure(body.items.length > 0, 'the PU has supporters')
      ensure(body.items.every((s: any) => s.puCode === '19/01/01/001'), 'only the asked PU')
      ensure(body.items.every((s: any) => s.masked === false && E164.test(s.phone)), 'PU and ward leads see full phones')
    },
  },
  'GET /api/supporters/:id': {
    request: fx => ({ method: 'GET', path: `/api/supporters/${fx.supporterView}` }),
    expect: only({ kanoWard: 200, kanoPu: 200 }, 404),
    check: (caller, body) => {
      ensure(E164.test(body.supporter.phone), 'full phone in scope')
      ensure(body.canEdit === (caller === 'kanoPu'), 'only the PU lead may edit')
    },
  },
  // Non-PU roles are refused before the lookup (403); another PU's lead finds nothing (404).
  'PATCH /api/supporters/:id': {
    request: fx => ({ method: 'PATCH', path: `/api/supporters/${fx.supporterView}`, body: { volunteer: true } }),
    expect: only({ kanoPu: 200, katsinaPu: 404 }),
  },
  'POST /api/supporters/:id/removal': {
    request: (fx, caller) => ({
      method: 'POST',
      path: `/api/supporters/${caller === 'kanoPu' ? fx.supporterRemovePu : caller === 'kanoWard' ? fx.supporterRemoveWard : fx.supporterOther}/removal`,
      body: { reason: 'Access suite' },
    }),
    expect: only({ kanoWard: 200, kanoPu: 200 }, 404),
    check: (_caller, body) => ensure(body.supporter.status === 'removal_requested', 'status is removal_requested'),
  },
  'GET /api/supporters/check-phone': {
    request: () => ({ method: 'GET', path: '/api/supporters/check-phone?phone=08031234567' }),
    expect: only({ kanoPu: 200, katsinaPu: 200 }),
    check: (_caller, body) => ensure(
      JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['countInSystem', 'limitReached', 'samePu']),
      'counts only',
    ),
  },

  // ── Units: registered voters from the field (US-24) ─────────────────────────
  // Aggregates for the Kano ward: anyone whose scope contains it (admin included); a PU lead's scope doesn't.
  'GET /api/units/:code/registered-voters': {
    request: () => ({ method: 'GET', path: '/api/units/19-01-01/registered-voters' }),
    expect: only({ admin: 200, dg: 200, kanoState: 200, kanoLga: 200, kanoWard: 200 }),
    check: (_caller, body) => {
      ensure(body.level === 'ward' && body.totalPus === 10, 'the ward summary covers its 10 PUs')
      ensure(body.pusWithFigure <= body.totalPus, 'reported ≤ total')
      ensure(!('registeredVotersReportedBy' in body), 'who reported stays on the server')
    },
  },
  // The PU's own lead (19/01/01/001) or its ward lead (19/01/01/003); denied callers aim at 19/01/01/007.
  'PUT /api/units/:code/registered-voters': {
    request: (_fx, caller) => ({
      method: 'PUT',
      path: `/api/units/${caller === 'kanoPu' ? '19-01-01-001' : caller === 'kanoWard' ? '19-01-01-003' : '19-01-01-007'}/registered-voters`,
      body: { registeredVoters: 420 },
    }),
    expect: only({ kanoPu: 200, kanoWard: 200 }),
    check: (_caller, body) => ensure(body.registeredVoters === 420 && typeof body.reportedAt === 'string', 'figure and report time saved'),
  },

  // ── Sync ───────────────────────────────────────────────────────────────────
  // Every caller pushes one item for the Kano PU: only its lead's is accepted; the Katsina PU lead gets out_of_scope.
  'POST /api/sync/push': {
    request: () => ({ method: 'POST', path: '/api/sync/push', body: { items: [pushItem('19/01/01/001')] } }),
    expect: only({ kanoPu: 200, katsinaPu: 200 }),
    check: (caller, body) => {
      const [r] = body.results
      if (caller === 'kanoPu') ensure(r.result === 'accepted', 'own PU accepted')
      else ensure(r.result === 'rejected' && r.reason === 'out_of_scope', 'another PU is out_of_scope')
    },
  },
} satisfies Record<string, AccessEntry>

export type AccessRoute = keyof typeof ACCESS_MATRIX

/** Keys that must never appear anywhere in an API response. */
export const FORBIDDEN_RESPONSE_KEYS = ['pinHash', 'tokenHash', 'codeHash', 'token', 'deviceId', 'updatedBy', 'otp', 'pin']
