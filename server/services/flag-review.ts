// Flag review (task 5.4, ADR-043, SECURITY_PRIVACY §3): ward, LGA and state leads and the DG list the flags in their
// scope and dismiss or confirm them. Ward leads see the supporter in full; everyone above sees initials and a masked
// phone. A later review (a supervisor overruling) replaces the earlier one; every review is audited, never the note.
// Pure (DB injected); supporter rows are serialised by services/supporters.ts.
import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db, DbLike } from '../db/client.ts'
import { flags, supporters, users } from '../db/schema/index.ts'
import type { FlagType } from '../../shared/constants/enums.ts'
import type { Role } from '../../shared/constants/roles.ts'
import { encodeFlagCursor, type FlagListQuery, type FlagResolveInput } from '../../shared/schemas/flags.ts'
import type { SessionUser } from '../../shared/types/auth.ts'
import type { FlagDto, FlagListResponse, FlagSubject } from '../../shared/types/flags.ts'
import { isWithin } from '../../shared/utils/pu-code.ts'
import { recordAudit } from './audit.ts'
import { refreshFlaggedOpen } from './flags.ts'
import { serializeSupporter } from './supporters.ts'

type Caller = Pick<SessionUser, 'id' | 'role' | 'unitCode'>

export const FLAG_REVIEW_ROLES: readonly Role[] = ['WARD_LEAD', 'LGA_LEAD', 'STATE_LEAD', 'DG']

/** The caller's review scope: a unit code, `''` for the whole region (DG), or null when they don't review flags. */
function reviewScope(caller: Caller): string | null {
  if (!FLAG_REVIEW_ROLES.includes(caller.role)) return null
  if (caller.role === 'DG') return ''
  return caller.unitCode || null
}

/** The unit itself and everything under it (the text_pattern_ops range, as scopeWhere); '' = everywhere. */
const underUnit = (unitCode: string): SQL => unitCode === ''
  ? sql`true`
  : sql`(${flags.puCode} ~>=~ ${unitCode} and ${flags.puCode} ~<~ ${`${unitCode}0`})`

const lead = alias(users, 'flag_lead')
const reviewer = alias(users, 'flag_reviewer')

export type ListFlagsResult = { kind: 'ok', body: FlagListResponse } | { kind: 'forbidden' }

export async function listFlags(db: DbLike, caller: Caller, query: FlagListQuery): Promise<ListFlagsResult> {
  const scope = reviewScope(caller)
  if (scope === null) return { kind: 'forbidden' }
  if (query.unit && !isWithin(query.unit, scope)) return { kind: 'forbidden' }
  const unit = query.unit ?? scope

  const conditions: SQL[] = [underUnit(unit)]
  conditions.push(query.status === 'open' ? eq(flags.status, 'open') : ne(flags.status, 'open'))
  if (query.type) conditions.push(eq(flags.type, query.type))
  if (query.cursor) {
    conditions.push(sql`(floor(extract(epoch from ${flags.createdAt}) * 1000)::bigint, ${flags.id}) < (${query.cursor.at}, ${query.cursor.id}::uuid)`)
  }

  const rows = await db.select({
    flag: flags,
    supporter: supporters,
    lead: { id: lead.id, fullName: lead.fullName, unitCode: lead.unitCode },
    reviewer: { fullName: reviewer.fullName },
    at: sql<number>`floor(extract(epoch from ${flags.createdAt}) * 1000)::bigint`,
  }).from(flags)
    .leftJoin(supporters, eq(supporters.id, flags.supporterId))
    .leftJoin(lead, eq(lead.id, flags.userId))
    .leftJoin(reviewer, eq(reviewer.id, flags.reviewedBy))
    .where(and(...conditions))
    .orderBy(desc(sql`floor(extract(epoch from ${flags.createdAt}) * 1000)::bigint`), desc(flags.id))
    .limit(query.limit + 1)

  const page = rows.slice(0, query.limit)
  const last = page[page.length - 1]
  const items: FlagDto[] = page.map((r) => {
    const subject: FlagSubject = r.flag.supporterId && r.supporter
      ? { kind: 'supporter', supporter: serializeSupporter(r.supporter, caller.role) }
      : r.flag.userId
        ? { kind: 'lead', lead: r.lead?.id ? { id: r.lead.id, fullName: r.lead.fullName, unitCode: r.lead.unitCode } : null }
        : { kind: 'pu' }
    return {
      id: r.flag.id,
      type: r.flag.type,
      status: r.flag.status,
      puCode: r.flag.puCode,
      createdAt: r.flag.createdAt.toISOString(),
      details: r.flag.details as Record<string, unknown>,
      subject,
      reviewedAt: r.flag.reviewedAt?.toISOString() ?? null,
      reviewedBy: r.reviewer?.fullName ? { fullName: r.reviewer.fullName } : null,
      reviewNote: r.flag.reviewNote,
    }
  })

  const counts = await db.select({ type: flags.type, n: sql<number>`count(*)::int` }).from(flags)
    .where(and(underUnit(unit), eq(flags.status, 'open')))
    .groupBy(flags.type)
  const openCounts: Partial<Record<FlagType, number>> = Object.fromEntries(counts.map(c => [c.type, c.n]))

  return {
    kind: 'ok',
    body: {
      items,
      nextCursor: rows.length > query.limit && last ? encodeFlagCursor({ at: Number(last.at), id: last.flag.id }) : null,
      openCounts,
    },
  }
}

export type ResolveFlagResult
  = | { kind: 'ok', flag: { id: string, status: 'dismissed' | 'confirmed' } }
    | { kind: 'forbidden' }
    | { kind: 'not_found' }

/**
 * Dismiss or confirm a flag in the caller's scope. A flag already reviewed can be reviewed again (a supervisor
 * overruling); the latest review wins. Audited with the type and the change, never the note.
 */
export async function resolveFlag(db: Db, caller: Caller, id: string, input: { status: FlagResolveInput['status'], note?: string }): Promise<ResolveFlagResult> {
  const scope = reviewScope(caller)
  if (scope === null) return { kind: 'forbidden' }
  return db.transaction(async (tx) => {
    const [flag] = await tx.select().from(flags).where(eq(flags.id, id)).for('update')
    // Out of scope looks like no flag at all.
    if (!flag || !isWithin(flag.puCode, scope)) return { kind: 'not_found' } as const
    await tx.update(flags).set({
      status: input.status,
      reviewedBy: caller.id,
      reviewedAt: sql`now()`,
      reviewNote: input.note ?? null,
    }).where(eq(flags.id, id))
    await refreshFlaggedOpen(tx, [flag.puCode])
    await recordAudit(tx, { id: caller.id, role: caller.role, ip: null }, {
      action: 'flag.resolve',
      targetType: flag.supporterId ? 'supporter' : flag.userId ? 'user' : 'unit',
      targetId: flag.supporterId ?? flag.userId ?? flag.puCode,
      scopeCode: flag.puCode,
      meta: { flagId: flag.id, type: flag.type, from: flag.status, to: input.status },
    })
    return { kind: 'ok', flag: { id: flag.id, status: input.status } } as const
  })
}
