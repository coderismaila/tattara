// The sync engine (task 4.3, ARCHITECTURE §5): push the outbox in batches, then pull the lead's unit. Runs from the app
// (useSync: start, online, every minute, after a capture) and from the service worker (Background Sync, push only).
// One run at a time per phone: a Web Lock covers tabs and the service worker. The server upserts by id, so a run cut
// short (app killed after the server saved but before the answer arrived) only leads to a `duplicate` answer later.
import { SYNC_LOCK } from '~~/shared/constants/sync'
import type { SyncItemResult } from '~~/shared/types/supporter'
import { db, getMeta, setMeta } from './db'
import { getLocalSession } from './local-session'
import { PullSessionGone, pullAll, type PullGet } from './pull'
import { pushOutbox, type PushPost } from './push'

export interface SyncOptions {
  /** Ignore the backoff (the lead asked, the phone came back online, a capture was just saved). */
  force?: boolean
  /** Also pull (default true). Capture skips it so the lead isn't kept waiting. */
  pull?: boolean
  post?: PushPost
  get?: PullGet
}

export interface SyncReport {
  /** Every per-item answer this run received. */
  results: SyncItemResult[]
  /** Set when a push went unanswered: the HTTP status, or null with no answer (offline, network). */
  pushError?: number | null
  pullError?: number | null
  /** Pull completed in this run. */
  pulled: boolean
  /** The run didn't start: no local session (signed out or wiped). */
  skipped?: boolean
}

/** Statuses after which retrying in this run is pointless: signed out, not allowed. */
const STOP_STATUSES = new Set([401, 403])

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  return locks ? locks.request(SYNC_LOCK, fn) : fn()
}

/** One run: every due batch, oldest first (each row at most once per run), then a full pull. */
export async function runSync(options: SyncOptions = {}): Promise<SyncReport> {
  return withLock(async () => {
    const report: SyncReport = { results: [], pulled: false }
    const session = await getLocalSession().catch(() => undefined)
    if (!session) return { ...report, skipped: true }

    let afterSeq: number | undefined
    for (;;) {
      const outcome = await pushOutbox({
        post: options.post,
        afterSeq,
        dueBy: options.force ? undefined : new Date().toISOString(),
      })
      if (!outcome.sent) {
        report.pushError = outcome.statusCode
        break
      }
      if (outcome.lastSeq === null) break
      report.results.push(...outcome.results)
      afterSeq = outcome.lastSeq
    }

    if (report.pushError === undefined) await markSynced(session.userId)

    const stop = report.pushError != null && STOP_STATUSES.has(report.pushError)
    const pulls = session.role === 'PU_LEAD' || session.role === 'WARD_LEAD'
    if (options.pull !== false && !stop && pulls && session.unitCode) {
      try {
        await pullAll(session.userId, session.unitCode, options.get)
        report.pulled = true
      }
      catch (error) {
        if (error instanceof PullSessionGone) return { ...report, skipped: true }
        report.pullError = (error as { statusCode?: number }).statusCode ?? null
      }
    }
    return report
  })
}

const LAST_SYNC_KEY = 'lastSyncAt'

/** When the server last answered a push (or there was nothing to send): "Last sent" on the Sync screen. */
export const getLastSyncAt = () => getMeta<string>(LAST_SYNC_KEY)

/** Only while the same lead is signed in: a phone wiped during the run stays empty. */
async function markSynced(userId: string) {
  await db.transaction('rw', db.meta, async () => {
    const session = (await db.meta.get('session'))?.value as { userId?: string } | undefined
    if (session?.userId === userId) await setMeta(LAST_SYNC_KEY, new Date().toISOString())
  }).catch(() => {})
}

let running: Promise<SyncReport> | null = null
let next: { promise: Promise<SyncReport>, options: SyncOptions } | null = null

/**
 * Run now, or right after the run in progress (which may have started before the newest capture was saved). Calls
 * made while one is waiting share it, with their options merged (force and pull win).
 */
export function syncNow(options: SyncOptions = {}): Promise<SyncReport> {
  if (!running) {
    running = runSync(options).finally(() => {
      running = null
    })
    return running
  }
  if (next) {
    next.options.force ||= options.force
    if (options.pull !== false) next.options.pull = true
    return next.promise
  }
  const queued: SyncOptions = { ...options }
  const promise = running.catch(() => undefined).then(() => {
    next = null
    return syncNow(queued)
  })
  next = { promise, options: queued }
  return promise
}
