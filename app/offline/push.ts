// Send queued captures to POST /api/sync/push (task 4.2). One batch per call, oldest first. 4.3 wraps this in the sync
// engine (timer, backoff, Background Sync, pull); capture calls it right after a save while online.
import type { SyncItemResult } from '~~/shared/types/supporter'
import { applyResults, listOutbox, markAttempted } from './outbox'

/** Server batch limit (API.md: ≤ 50 items per push). */
export const PUSH_BATCH_SIZE = 50

export type PushOutcome
  = | { sent: true, results: SyncItemResult[] }
  /** Nothing was answered: offline, server error, rate limit or signed out. The rows stay queued. */
    | { sent: false, statusCode: number | null }

export async function pushOutbox(): Promise<PushOutcome> {
  const rows = await listOutbox(PUSH_BATCH_SIZE)
  if (!rows.length) return { sent: true, results: [] }
  try {
    const { results } = await $fetch<{ results: SyncItemResult[] }>('/api/sync/push', {
      method: 'POST',
      body: { items: rows.map(r => r.payload) },
    })
    await applyResults(results)
    return { sent: true, results }
  }
  catch (error) {
    await markAttempted(rows.map(r => r.seq!)).catch(() => {})
    return { sent: false, statusCode: (error as { statusCode?: number }).statusCode ?? null }
  }
}
