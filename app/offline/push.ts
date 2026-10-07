// Send queued captures to POST /api/sync/push (tasks 4.2–4.3). One batch per call, oldest first. The sync engine
// (sync.ts) loops over it; the service worker calls the same code with its own `post` (no Nuxt there).
import type { SupporterInput, SyncItemResult } from '~~/shared/types/supporter'
import { applyResults, listOutbox, markAttempted, type ListOutboxOptions } from './outbox'

/** Server batch limit (API.md: ≤ 50 items per push). */
export const PUSH_BATCH_SIZE = 50

/** Sends a batch. Throws on no answer, with `statusCode` when the server answered with an error. */
export type PushPost = (items: SupporterInput[]) => Promise<{ results: SyncItemResult[] }>

export type PushOutcome
  = | { sent: true, results: SyncItemResult[], lastSeq: number | null }
  /** Nothing was answered: offline, server error, rate limit or signed out. The rows stay queued. */
    | { sent: false, statusCode: number | null }

/** The app's sender ($fetch, with Nuxt's error shape). */
export const nuxtPost: PushPost = items => $fetch<{ results: SyncItemResult[] }>('/api/sync/push', { method: 'POST', body: { items } })

export async function pushOutbox(options: ListOutboxOptions & { post?: PushPost } = {}): Promise<PushOutcome> {
  const rows = await listOutbox(PUSH_BATCH_SIZE, options)
  if (!rows.length) return { sent: true, results: [], lastSeq: null }
  try {
    const { results } = await (options.post ?? nuxtPost)(rows.map(r => r.payload))
    await applyResults(results)
    return { sent: true, results, lastSeq: rows[rows.length - 1]!.seq! }
  }
  catch (error) {
    await markAttempted(rows.map(r => r.seq!)).catch(() => {})
    return { sent: false, statusCode: (error as { statusCode?: number }).statusCode ?? null }
  }
}
