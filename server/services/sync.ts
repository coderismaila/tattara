// GET /api/sync/pull (task 4.3, ARCHITECTURE §5 step 6): what a PU or ward lead's phone keeps current offline. Their
// unit's supporters changed since the last pull (anonymised ones as tombstones), their unit subtree, and totals.
// Pure (DB injected). Supporter rows come only through services/supporters.ts.
import { sql } from 'drizzle-orm'
import type { DbLike } from '../db/client.ts'
import { puStats, units } from '../db/schema/index.ts'
import { PULL_OVERLAP_MS, PULL_PAGE_SIZE } from '../../shared/constants/sync.ts'
import { encodePullCursor, type SyncPullQuery } from '../../shared/schemas/sync.ts'
import type { SessionUser } from '../../shared/types/auth.ts'
import type { SupporterDto } from '../../shared/types/supporter.ts'
import type { PullResponse, PullStats, PullUnit } from '../../shared/types/sync.ts'
import { pullSupporters, serializeSupporter } from './supporters.ts'

type Caller = Pick<SessionUser, 'id' | 'role' | 'unitCode'>

export type PullResult = { kind: 'ok', body: PullResponse } | { kind: 'forbidden' }

/** The unit itself and everything under it (the text_pattern_ops range, as scopeWhere). */
const underUnit = (col: typeof units.code | typeof puStats.puCode, unitCode: string) =>
  sql`(${col} ~>=~ ${unitCode} and ${col} ~<~ ${`${unitCode}0`})`

async function unitSubtree(db: DbLike, unitCode: string): Promise<PullUnit[]> {
  return db.select({ code: units.code, parentCode: units.parentCode, name: units.name, level: units.level, active: units.active })
    .from(units).where(underUnit(units.code, unitCode)).orderBy(units.code)
}

async function unitStats(db: DbLike, unitCode: string): Promise<PullStats> {
  const [row] = await db.select({
    total: sql<number>`coalesce(sum(${puStats.total}), 0)::int`,
    verified: sql<number>`coalesce(sum(${puStats.verified}), 0)::int`,
    flaggedOpen: sql<number>`coalesce(sum(${puStats.flaggedOpen}), 0)::int`,
    lastCaptureAt: sql<string | null>`to_char(max(${puStats.lastCaptureAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  }).from(puStats).where(underUnit(puStats.puCode, unitCode))
  return { total: row?.total ?? 0, verified: row?.verified ?? 0, flaggedOpen: row?.flaggedOpen ?? 0, lastCaptureAt: row?.lastCaptureAt ?? null }
}

/**
 * One pull page. `serverTime` is read before the supporters (and set back by PULL_OVERLAP_MS), so anything written
 * after this read is picked up by the next pull. Units go with the first page only.
 */
export async function pullForCaller(db: DbLike, caller: Caller, query: SyncPullQuery, limit = PULL_PAGE_SIZE): Promise<PullResult> {
  const [clock] = await db.execute<{ now: string }>(sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`)
  const serverTime = new Date(new Date(clock!.now).getTime() - PULL_OVERLAP_MS).toISOString()

  const page = await pullSupporters(db, caller, { since: query.since, cursor: query.cursor, limit })
  if (page.kind === 'forbidden') return { kind: 'forbidden' }
  const unitCode = caller.unitCode!

  return {
    kind: 'ok',
    body: {
      supporters: page.items.map(row => row.status === 'anonymised'
        ? { id: row.id, deleted: true as const }
        // PU and ward leads only reach here, so the record is the full one (SECURITY_PRIVACY §3).
        : serializeSupporter(row, caller.role) as SupporterDto),
      units: query.cursor ? [] : await unitSubtree(db, unitCode),
      stats: await unitStats(db, unitCode),
      announcements: [],
      serverTime,
      nextCursor: page.nextCursor ? encodePullCursor(page.nextCursor) : null,
    },
  }
}
