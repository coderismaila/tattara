// Scope = the part of the INEC hierarchy a user may see (ADR-002, ARCHITECTURE §4, SECURITY_PRIVACY §3–4).
// Every server read/write of supporter or user data goes through requireScope / scopeWhere. No exceptions.
import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { createError, type H3Event } from 'h3'
import { ROLE_LEVEL, isRole, type Role } from '../../shared/constants/roles.ts'
import { isValidPuCode, isWithin, scopePrefix, unitLevel } from '../../shared/utils/pu-code.ts'
import type { SessionUser } from '../../shared/types/auth.ts'
import { requireAuth } from './auth.ts'

export interface Scope {
  role: Role
  /** Unit code the user leads; `''` = the whole region (DG, ADMIN). */
  unitCode: string
  /** `unitCode + '/'`, or `''` for the region. */
  prefix: string
}

export interface ScopeOptions {
  /**
   * ADMIN is region-wide for administration but has no default access to supporter data (SECURITY §3).
   * Only aggregate/geography routes pass `allowAdmin: true`.
   */
  allowAdmin?: boolean
}

const forbidden = () => createError({ statusCode: 403, statusMessage: 'Forbidden' })

/** Derive the scope from the session user. A lead without a matching valid unit gets no scope, never a wider one. */
export function scopeForUser(user: Pick<SessionUser, 'role' | 'unitCode'>): Scope {
  if (!isRole(user.role)) throw forbidden()
  const level = ROLE_LEVEL[user.role]
  if (level === null) {
    return { role: user.role, unitCode: '', prefix: '' }
  }
  const code = user.unitCode ?? ''
  if (!isValidPuCode(code) || unitLevel(code) !== level) throw forbidden()
  return { role: user.role, unitCode: code, prefix: scopePrefix(code) }
}

/** The caller's scope. 401 without a valid session (see requireAuth). */
export async function getScope(event: H3Event): Promise<Scope> {
  const { user } = await requireAuth(event)
  return scopeForUser(user)
}

/** Is `code` (a unit or PU code) inside the scope? Malformed codes never are. */
export function canAccess(scope: Scope, code: string, options: ScopeOptions = {}): boolean {
  if (scope.role === 'ADMIN' && !options.allowAdmin) return false
  return isWithin(code, scope.unitCode)
}

/** 403 unless `code` is inside the caller's scope. Returns the scope for further use. */
export async function requireScope(event: H3Event, code: string, options: ScopeOptions = {}): Promise<Scope> {
  const scope = await getScope(event)
  if (!canAccess(scope, code, options)) throw forbidden()
  return scope
}

/**
 * WHERE fragment limiting `column` (a unit/PU code column) to the scope.
 * Uses the text_pattern_ops operators as a range (`~>=~ unit AND ~<~ unit || '0'`), which covers the unit itself and
 * everything under `unit/` ('/' sorts just below '0'), and keeps using the text_pattern_ops index even with bind
 * parameters and generic plans, where `LIKE $1` would not.
 */
export function scopeWhere(column: AnyPgColumn | SQL, scope: Scope, options: ScopeOptions = {}): SQL {
  if (scope.role === 'ADMIN' && !options.allowAdmin) return sql`false`
  if (scope.unitCode === '') return sql`true`
  return sql`(${column} ~>=~ ${scope.unitCode} and ${column} ~<~ ${`${scope.unitCode}0`})`
}
