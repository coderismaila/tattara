// Local-first capture (task 4.2, ARCHITECTURE §5): a supporter is written to the phone and queued for the server in
// one transaction; server results then mark it synced or rejected. Outbox rows leave only when the server has
// answered for them (accepted, duplicate, rejected or conflict), never on a network error.
import { PUSH_BACKOFF_BASE_MS, PUSH_BACKOFF_MAX_MS } from '~~/shared/constants/sync'
import type { SupporterInput, SyncItemResult } from '~~/shared/types/supporter'
import { db, type LocalSupporter, type OutboxRow } from './db'

/** Save a new capture on the phone and queue it. Safe to call twice with the same id (nothing is queued twice). */
export async function saveCapture(item: SupporterInput): Promise<void> {
  const now = new Date().toISOString()
  await db.transaction('rw', db.supporters, db.outbox, async () => {
    if (await db.supporters.get(item.id)) return
    await db.supporters.add({ ...item, syncStatus: 'pending' })
    await db.outbox.add({ id: item.id, kind: 'create', payload: item, createdAt: now, attempts: 0, nextAttemptAt: now })
  })
}

/** Remove a capture the lead is about to correct and save again (it was refused while they were still there). */
export async function discardCapture(id: string): Promise<void> {
  await db.transaction('rw', db.supporters, db.outbox, async () => {
    await db.supporters.delete(id)
    await db.outbox.where('id').equals(id).delete()
  })
}

export interface ListOutboxOptions {
  /** Only rows whose backoff has run out by this ISO time. */
  dueBy?: string
  /** Only rows queued after this one (the engine never sends a row twice in one run). */
  afterSeq?: number
}

/** Oldest first: the order they were captured in. */
export function listOutbox(limit = Infinity, options: ListOutboxOptions = {}): Promise<OutboxRow[]> {
  const { dueBy, afterSeq } = options
  const rows = afterSeq === undefined ? db.outbox.orderBy('seq') : db.outbox.where('seq').above(afterSeq)
  return (dueBy === undefined ? rows : rows.filter(r => r.nextAttemptAt <= dueBy)).limit(limit).toArray()
}

/**
 * Wait before retrying a row after `attempts` unanswered pushes: doubling from 30 s, at most 30 min (ARCHITECTURE §5),
 * spread over the upper half so phones that lost the network together don't all retry at the same moment.
 */
export function backoffMs(attempts: number, random = Math.random): number {
  const cap = Math.min(PUSH_BACKOFF_MAX_MS, PUSH_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1))
  return Math.round(cap * (0.5 + random() * 0.5))
}

export function pendingCount(): Promise<number> {
  return db.outbox.count()
}

/** Apply the server's per-item answers to the local records and drop the answered outbox rows. */
export async function applyResults(results: SyncItemResult[]): Promise<void> {
  await db.transaction('rw', db.supporters, db.outbox, async () => {
    for (const r of results) {
      if (!r.id) continue // a rejection the server couldn't tie to an id; the row stays and shows on the Sync screen
      if (r.result === 'accepted' || r.result === 'duplicate') {
        await db.supporters.update(r.id, { syncStatus: 'synced', serverUpdatedAt: r.serverUpdatedAt, rejectReason: undefined, issues: undefined })
      }
      else if (r.result === 'rejected') {
        await db.supporters.update(r.id, { syncStatus: 'rejected', rejectReason: r.reason, issues: r.issues })
      }
      else {
        await db.supporters.update(r.id, { syncStatus: 'rejected', rejectReason: 'conflict' })
      }
      await db.outbox.where('id').equals(r.id).delete()
    }
  })
}

/** Count failed attempts (network or server errors) on rows that were sent but not answered, and back them off. */
export async function markAttempted(seqs: number[], now = Date.now()): Promise<void> {
  await db.outbox.where('seq').anyOf(seqs).modify((row) => {
    row.attempts++
    row.nextAttemptAt = new Date(now + backoffMs(row.attempts)).toISOString()
  })
}

/** When the earliest backed-off row may be retried (ISO), or null with nothing queued. */
export async function nextAttemptAt(): Promise<string | null> {
  return (await db.outbox.orderBy('nextAttemptAt').first())?.nextAttemptAt ?? null
}

/**
 * Supporters with this phone on this PU held on the phone (offline duplicate notice, US-7). Rejected captures don't
 * count: the server never took them.
 */
export async function countLocalPhone(puCode: string, phone: string): Promise<number> {
  return db.supporters
    .where('phone').equals(phone)
    .filter((s: LocalSupporter) => s.puCode === puCode && s.syncStatus !== 'rejected')
    .count()
}
