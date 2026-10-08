// Call-back audits (PRD US-10, task 5.3, ADR-042): every morning each ward gets a random 5% of the supporters added
// the day before; the ward lead phones them and records verified / wrong number / denies / unreachable, which updates
// the supporter's verification (and raises a callback_failed flag). Pure (DB injected).
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import { callbacks, flags, supporters } from '../db/schema/index.ts'
import type { CallbackOutcome, VerificationStatus } from '../../shared/constants/enums.ts'
import type { SessionUser } from '../../shared/types/auth.ts'
import type { CallbackItem, CallbackPassRate } from '../../shared/types/callbacks.ts'
import { addDays } from '../../shared/utils/lagos-date.ts'
import { recordAudit } from './audit.ts'
import { refreshFlaggedOpen } from './flags.ts'
import { applyCallbackVerification } from './supporters.ts'

type Caller = Pick<SessionUser, 'id' | 'role' | 'unitCode'>

/** Share of a ward's new supporters called back (PRD US-10 default). */
export const CALLBACK_SAMPLE_RATE = 0.05
/** Missed days (task down, deploy) are sampled late, up to this far back. */
export const CALLBACK_LOOKBACK_DAYS = 7
/** Pass rate window shown to the ward lead. */
export const CALLBACK_PASS_RATE_DAYS = 30

/** Calls for `n` eligible new supporters: 5%, rounded up, so a ward with any new supporter gets at least one. */
export function sampleSize(n: number, rate = CALLBACK_SAMPLE_RATE): number {
  return n > 0 ? Math.ceil(n * rate) : 0
}

/**
 * Draw the samples for the supporters added on each of the `lookbackDays` Lagos days before `today` (due the day after
 * they were added). A ward already sampled for a day is skipped, and a supporter is sampled at most once, so reruns
 * add nothing. Only live supporters with a phone who haven't opted out. Returns the calls created.
 */
export async function sampleCallbacks(db: Db, today: string, lookbackDays = CALLBACK_LOOKBACK_DAYS): Promise<number> {
  let created = 0
  for (let back = lookbackDays; back >= 1; back--) {
    const day = addDays(today, -back)
    const due = addDays(day, 1)
    const rows = await db.execute<{ id: string }>(sql`
      with eligible as (
        select s.id, left(s.pu_code, 8) as ward,
          row_number() over (partition by left(s.pu_code, 8) order by random()) as rn,
          count(*) over (partition by left(s.pu_code, 8)) as n
        from supporters s
        where s.created_at >= (${day}::date::timestamp at time zone 'Africa/Lagos')
          and s.created_at < (${due}::date::timestamp at time zone 'Africa/Lagos')
          and s.status = 'active' and s.phone is not null and s.verification <> 'opted_out'
          and not exists (select 1 from callbacks c where c.supporter_id = s.id)
          and not exists (select 1 from callbacks c where c.ward_code = left(s.pu_code, 8) and c.due_date = ${due}::date)
      )
      insert into callbacks (id, supporter_id, ward_code, assigned_to, due_date)
      select gen_random_uuid(), e.id, e.ward,
        (select u.id from users u where u.unit_code = e.ward and u.role = 'WARD_LEAD' and u.status = 'active' limit 1),
        ${due}::date
      from eligible e
      where e.rn <= ceil(e.n * ${CALLBACK_SAMPLE_RATE}::numeric)
      on conflict do nothing
      returning id`)
    created += rows.length
  }
  return created
}

export type ListCallbacksResult = { kind: 'ok', date: string, items: CallbackItem[], passRate: CallbackPassRate } | { kind: 'forbidden' }

/**
 * The ward lead's calls for `date`: that day's, plus any still open from earlier days (oldest first). Records that
 * were anonymised meanwhile are left out (nothing to call). Ward leads only, own ward only.
 */
export async function listCallbacks(db: DbLike, caller: Caller, date: string): Promise<ListCallbacksResult> {
  if (caller.role !== 'WARD_LEAD' || !caller.unitCode) return { kind: 'forbidden' }
  const ward = caller.unitCode
  const rows = await db.select({ c: callbacks, s: supporters }).from(callbacks)
    .innerJoin(supporters, eq(supporters.id, callbacks.supporterId))
    .where(and(
      eq(callbacks.wardCode, ward),
      sql`(${callbacks.dueDate} = ${date}::date or (${callbacks.outcome} is null and ${callbacks.dueDate} < ${date}::date))`,
      sql`${supporters.status} <> 'anonymised'`,
    ))
    .orderBy(asc(callbacks.dueDate), sql`${callbacks.outcome} is not null`, asc(supporters.puCode), desc(callbacks.id))

  const items: CallbackItem[] = rows.map(({ c, s }) => ({
    id: c.id,
    dueDate: c.dueDate,
    overdue: c.dueDate < date,
    outcome: c.outcome,
    notes: c.notes,
    completedAt: c.completedAt?.toISOString() ?? null,
    supporter: {
      id: s.id,
      fullName: s.fullName,
      phone: s.phone ?? '',
      puCode: s.puCode,
      capturedAt: s.capturedAt.toISOString(),
      verification: s.verification,
    },
  }))
  return { kind: 'ok', date, items, passRate: await passRate(db, ward) }
}

/** Answered calls in the ward over the last 30 days (PRD success metric: ≥ 85%). Unreachable ones don't count. */
export async function passRate(db: DbLike, wardCode: string, days = CALLBACK_PASS_RATE_DAYS): Promise<CallbackPassRate> {
  const [row] = await db.select({
    verified: sql<number>`count(*) filter (where ${callbacks.outcome} = 'verified')::int`,
    failed: sql<number>`count(*) filter (where ${callbacks.outcome} in ('wrong_number', 'denies'))::int`,
    unreachable: sql<number>`count(*) filter (where ${callbacks.outcome} = 'unreachable')::int`,
  }).from(callbacks).where(and(
    sql`(${callbacks.wardCode} ~>=~ ${wardCode} and ${callbacks.wardCode} ~<~ ${`${wardCode}0`})`,
    sql`${callbacks.completedAt} > now() - ${days} * interval '1 day'`,
  ))
  const verified = row?.verified ?? 0
  const failed = row?.failed ?? 0
  return { days, verified, failed, unreachable: row?.unreachable ?? 0, rate: verified + failed ? verified / (verified + failed) : null }
}

export type CompleteCallbackResult
  = | { kind: 'ok', item: { id: string, outcome: CallbackOutcome, verification: VerificationStatus | null } }
    | { kind: 'forbidden' }
    | { kind: 'not_found' }
    | { kind: 'already_done' }

/**
 * Record a call's outcome (once; a recorded outcome can't be changed). Updates the supporter's verification, raises a
 * callback_failed flag for wrong number / denies, and audits the outcome (never the notes).
 */
export async function completeCallback(db: Db, caller: Caller, id: string, input: { outcome: CallbackOutcome, notes?: string }): Promise<CompleteCallbackResult> {
  if (caller.role !== 'WARD_LEAD' || !caller.unitCode) return { kind: 'forbidden' }
  return db.transaction(async (tx) => {
    const [call] = await tx.select().from(callbacks).where(eq(callbacks.id, id)).for('update')
    // Another ward's call looks like no call at all.
    if (!call || call.wardCode !== caller.unitCode) return { kind: 'not_found' } as const
    if (call.outcome) return { kind: 'already_done' } as const

    await tx.update(callbacks).set({
      outcome: input.outcome,
      notes: input.notes ?? null,
      completedAt: sql`now()`,
      completedBy: caller.id,
    }).where(eq(callbacks.id, id))
    const supporter = await applyCallbackVerification(tx, call.supporterId, input.outcome)

    if (supporter && (input.outcome === 'wrong_number' || input.outcome === 'denies') && supporter.status !== 'anonymised') {
      await tx.insert(flags).values({
        supporterId: supporter.id,
        puCode: supporter.puCode,
        type: 'callback_failed',
        details: { outcome: input.outcome },
      }).onConflictDoNothing()
      await refreshFlaggedOpen(tx, [supporter.puCode])
    }
    await recordAudit(tx, { id: caller.id, role: caller.role, ip: null }, {
      action: 'callback.complete',
      targetType: 'supporter',
      targetId: call.supporterId,
      scopeCode: supporter?.puCode ?? call.wardCode,
      meta: { callbackId: call.id, outcome: input.outcome },
    })
    return { kind: 'ok', item: { id: call.id, outcome: input.outcome, verification: supporter?.verification ?? null } } as const
  })
}
