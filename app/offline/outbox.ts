// Local-first capture (task 4.2, ARCHITECTURE §5): a supporter is written to the phone and queued for the server in
// one transaction; server results then mark it synced or rejected. Outbox rows leave only when the server has
// answered for them (accepted, duplicate, rejected or conflict), never on a network error.
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

/** Oldest first: the order they were captured in. */
export function listOutbox(limit = Infinity): Promise<OutboxRow[]> {
  return db.outbox.orderBy('seq').limit(limit).toArray()
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

/** Count failed attempts (network or server errors) on rows that were sent but not answered. */
export async function markAttempted(seqs: number[]): Promise<void> {
  await db.outbox.where('seq').anyOf(seqs).modify((row) => {
    row.attempts++
  })
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
