import { PgDialect } from 'drizzle-orm/pg-core'
import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { units } from '../../server/db/schema'
import { canAccess, getScope, requireScope, scopeForUser, scopeWhere, type Scope } from '../../server/utils/scope'
import type { Role } from '../../shared/constants/roles'

const session = vi.hoisted(() => ({ user: null as null | { role: string, unitCode: string | null } }))
vi.mock('../../server/auth/session', () => ({
  requireUserSession: vi.fn(async () => {
    if (!session.user) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    return { user: session.user }
  }),
}))

const event = {} as H3Event
const scope = (role: Role, unitCode: string | null) => scopeForUser({ role, unitCode })
const render = (s: Scope, opts?: { allowAdmin?: boolean }) => new PgDialect().sqlToQuery(scopeWhere(units.code, s, opts))
const statusOf = async (p: Promise<unknown>) => p.then(() => 200, (e: { statusCode?: number }) => e.statusCode)

beforeEach(() => {
  session.user = null
})

describe('scopeForUser', () => {
  it.each([
    ['DG', null, ''],
    ['ADMIN', null, ''],
    ['STATE_LEAD', '19', '19'],
    ['LGA_LEAD', '19/05', '19/05'],
    ['WARD_LEAD', '19/05/03', '19/05/03'],
    ['PU_LEAD', '19/05/03/012', '19/05/03/012'],
  ] as const)('%s at %s → unit %j', (role, unitCode, expected) => {
    const s = scope(role, unitCode)
    expect(s).toEqual({ role, unitCode: expected, prefix: expected ? `${expected}/` : '' })
  })

  it('region roles ignore any unit code (never narrower or wider by accident)', () => {
    expect(scope('DG', '19').unitCode).toBe('')
  })

  it.each([
    ['lead without a unit', 'WARD_LEAD', null],
    ['lead with a unit of the wrong level', 'WARD_LEAD', '19/05'],
    ['lead with a malformed unit', 'LGA_LEAD', '19/5'],
    ['lead with an empty unit', 'STATE_LEAD', ''],
    ['unknown role', 'SUPERUSER', null],
  ])('refuses a %s (403, not a wider scope)', (_label, role, unitCode) => {
    expect(() => scopeForUser({ role: role as Role, unitCode })).toThrow(expect.objectContaining({ statusCode: 403 }))
  })
})

describe('canAccess', () => {
  const lga = scope('LGA_LEAD', '19/05')

  it('allows the unit itself and everything below it', () => {
    for (const code of ['19/05', '19/05/03', '19/05/03/012']) expect(canAccess(lga, code)).toBe(true)
  })

  it('denies siblings, parents, other states, look-alikes and malformed codes', () => {
    for (const code of ['19/06', '19', '20/05', '19/05/03/0123', '19/050', '19/05/', '', 'x']) {
      expect(canAccess(lga, code), code).toBe(false)
    }
  })

  it('a PU lead reaches only their PU', () => {
    const pu = scope('PU_LEAD', '19/05/03/012')
    expect(canAccess(pu, '19/05/03/012')).toBe(true)
    expect(canAccess(pu, '19/05/03/013')).toBe(false)
    expect(canAccess(pu, '19/05/03')).toBe(false)
  })

  it('DG reaches the whole region', () => {
    expect(canAccess(scope('DG', null), '36/14/10/147')).toBe(true)
  })

  it('ADMIN is denied by default and allowed only when the route opts in', () => {
    const admin = scope('ADMIN', null)
    expect(canAccess(admin, '19/05')).toBe(false)
    expect(canAccess(admin, '19/05', { allowAdmin: true })).toBe(true)
  })
})

describe('getScope / requireScope (with a session)', () => {
  it('401 without a session', async () => {
    expect(await statusOf(getScope(event))).toBe(401)
    expect(await statusOf(requireScope(event, '19'))).toBe(401)
  })

  it('returns the scope of the session user', async () => {
    session.user = { role: 'WARD_LEAD', unitCode: '19/05/03' }
    expect(await getScope(event)).toEqual({ role: 'WARD_LEAD', unitCode: '19/05/03', prefix: '19/05/03/' })
  })

  it('requireScope passes in scope and returns the scope', async () => {
    session.user = { role: 'WARD_LEAD', unitCode: '19/05/03' }
    expect(await requireScope(event, '19/05/03/012')).toMatchObject({ unitCode: '19/05/03' })
  })

  it('requireScope answers 403 out of scope, for malformed codes, and for ADMIN by default', async () => {
    session.user = { role: 'WARD_LEAD', unitCode: '19/05/03' }
    expect(await statusOf(requireScope(event, '19/05/04/001'))).toBe(403)
    expect(await statusOf(requireScope(event, '19/05/03/12'))).toBe(403)
    session.user = { role: 'ADMIN', unitCode: null }
    expect(await statusOf(requireScope(event, '19'))).toBe(403)
    expect(await statusOf(requireScope(event, '19', { allowAdmin: true }))).toBe(200)
  })

  it('a session whose unit no longer matches its role gets 403', async () => {
    session.user = { role: 'PU_LEAD', unitCode: '19/05/03' }
    expect(await statusOf(getScope(event))).toBe(403)
  })
})

describe('scopeWhere', () => {
  it('region scope → true; ADMIN without opt-in → false', () => {
    expect(render(scope('DG', null)).sql).toBe('true')
    expect(render(scope('ADMIN', null)).sql).toBe('false')
    expect(render(scope('ADMIN', null), { allowAdmin: true }).sql).toBe('true')
  })

  it('a unit scope becomes a text_pattern_ops range covering the unit and its descendants', () => {
    const q = render(scope('LGA_LEAD', '19/05'))
    expect(q.sql).toBe('("units"."code" ~>=~ $1 and "units"."code" ~<~ $2)')
    expect(q.params).toEqual(['19/05', '19/050'])
  })
})
