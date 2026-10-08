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
  /** A call-back due today in the Kano ward (on supporterOther), completed by the Kano ward lead. */
  callback: string
  /** An open gps_far flag on supporterView (19/01/01/001), reviewed by each Kano reviewer in turn. */
  flag: string
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
  // Each lead pulls only their own unit; nobody above ward holds supporter records offline.
  'GET /api/sync/pull': {
    request: () => ({ method: 'GET', path: '/api/sync/pull' }),
    expect: only({ kanoWard: 200, kanoPu: 200, katsinaWard: 200, katsinaPu: 200 }),
    check: (caller, body) => {
      const unit = { kanoWard: '19/01/01', kanoPu: '19/01/01/001', katsinaWard: '20/01/01', katsinaPu: '20/01/01/001' }[caller as 'kanoPu']
      ensure(unit, 'a PU or ward lead')
      const inUnit = (code: string) => code === unit || code.startsWith(`${unit}/`)
      const records = body.supporters.filter((s: any) => !s.deleted)
      ensure(records.length > 0, 'the unit has supporters')
      ensure(records.every((s: any) => inUnit(s.puCode)), 'only the caller\'s own unit')
      ensure(records.every((s: any) => s.masked === false && E164.test(s.phone)), 'PU and ward leads see full phones')
      ensure(body.units.length > 0 && body.units.every((u: any) => inUnit(u.code)), 'units of the caller\'s subtree only')
      ensure(typeof body.serverTime === 'string' && typeof body.stats.total === 'number', 'serverTime and stats')
    },
  },
  // Call-backs (5.3): ward leads only, each their own ward.
  'GET /api/callbacks': {
    request: () => ({ method: 'GET', path: '/api/callbacks' }),
    expect: only({ kanoWard: 200, katsinaWard: 200 }),
    check: (caller, body) => {
      const ward = caller === 'kanoWard' ? '19/01/01/' : '20/01/01/'
      ensure(body.items.every((i: any) => i.supporter.puCode.startsWith(ward)), 'only their own ward')
      if (caller === 'kanoWard') ensure(body.items.some((i: any) => E164.test(i.supporter.phone)), 'the ward lead sees phones to call')
      ensure(typeof body.passRate.days === 'number', 'pass rate')
    },
  },
  'POST /api/callbacks/:id': {
    request: fx => ({ method: 'POST', path: `/api/callbacks/${fx.callback}`, body: { outcome: 'verified' } }),
    expect: only({ kanoWard: 200, katsinaWard: 404 }),
    check: (_caller, body) => ensure(body.item.verification === 'callback_verified', 'verified'),
  },
  // Flag review (5.4): ward leads see supporters in full, LGA and above masked; each only their own unit.
  'GET /api/flags': {
    request: () => ({ method: 'GET', path: '/api/flags?limit=100' }),
    expect: only({ kanoWard: 200, kanoLga: 200, kanoState: 200, dg: 200, katsinaWard: 200, katsinaLga: 200, katsinaState: 200 }),
    check: (caller, body) => {
      const unit = { kanoWard: '19/01/01/', kanoLga: '19/01/', kanoState: '19/', katsinaWard: '20/01/01/', katsinaLga: '20/01/', katsinaState: '20/', dg: '' }[caller as 'dg']
      ensure(body.items.every((f: any) => f.puCode.startsWith(unit)), 'only flags in the caller’s unit')
      const supporters = body.items.filter((f: any) => f.subject.kind === 'supporter').map((f: any) => f.subject.supporter)
      if (caller === 'kanoWard') ensure(supporters.some((s: any) => s.masked === false && E164.test(s.phone)), 'the ward lead sees supporters in full')
      if (caller === 'kanoWard' || caller === 'katsinaWard') ensure(supporters.every((s: any) => s.masked === false), 'ward leads see supporters in full')
      else ensure(supporters.every((s: any) => s.masked === true && (s.phone === null || MASKED.test(s.phone)) && !('fullName' in s)), 'masked above ward')
    },
  },
  'POST /api/flags/:id/resolve': {
    request: fx => ({ method: 'POST', path: `/api/flags/${fx.flag}/resolve`, body: { status: 'dismissed' } }),
    expect: only({ kanoWard: 200, kanoLga: 200, kanoState: 200, dg: 200, katsinaWard: 404, katsinaLga: 404, katsinaState: 404 }),
    check: (_caller, body) => ensure(body.flag.status === 'dismissed', 'dismissed'),
  },
  // Stats (6.1): aggregates for anyone whose scope holds the unit, the admin included; never names or phones.
  'GET /api/stats/unit/:code': {
    request: () => ({ method: 'GET', path: '/api/stats/unit/19-01-01' }),
    expect: only({ admin: 200, dg: 200, kanoState: 200, kanoLga: 200, kanoWard: 200 }),
    check: (_caller, body) => {
      ensure(body.unit.code === '19/01/01' && typeof body.totals.supporters === 'number', 'ward totals')
      ensure(!JSON.stringify(body).match(/\+234|fullName/), 'no names or phones')
    },
  },
  'GET /api/stats/children/:code': {
    request: () => ({ method: 'GET', path: '/api/stats/children/19-01-01' }),
    expect: only({ admin: 200, dg: 200, kanoState: 200, kanoLga: 200, kanoWard: 200 }),
    check: (_caller, body) => {
      ensure(body.children.length > 0 && body.children.every((c: any) => c.code.startsWith('19/01/01/')), 'the ward’s PUs')
      ensure(!JSON.stringify(body).match(/\+234|fullName/), 'no names or phones')
    },
  },
  // Map PU points (6.3): aggregates and unit locations for anyone whose scope holds the ward.
  'GET /api/geo/pus': {
    request: () => ({ method: 'GET', path: '/api/geo/pus?ward=19-01-01' }),
    expect: only({ admin: 200, dg: 200, kanoState: 200, kanoLga: 200, kanoWard: 200 }),
    check: (_caller, body) => {
      ensure(body.ward === '19/01/01' && body.points.length > 0, 'the ward’s PUs')
      ensure(body.points.every((p: any) => p.code.startsWith('19/01/01/') && typeof p.lat === 'number'), 'points in the ward')
    },
  },
  // The provider's webhook: a session means nothing here, only the body's signature does (5.2).
  'POST /api/webhooks/sms': {
    request: () => ({ method: 'POST', path: '/api/webhooks/sms', body: { type: 'inbound', sender: '2348031234567', message: 'STOP' } }),
    expect: everyone(401),
  },
} satisfies Record<string, AccessEntry>

export type AccessRoute = keyof typeof ACCESS_MATRIX

/** Keys that must never appear anywhere in an API response. */
export const FORBIDDEN_RESPONSE_KEYS = ['pinHash', 'tokenHash', 'codeHash', 'token', 'deviceId', 'updatedBy', 'otp', 'pin']
