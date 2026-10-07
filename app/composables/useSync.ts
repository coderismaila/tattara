// The sync engine's state for the UI (task 4.3; the Sync screen and status pill come in 4.4). Runs go through
// `syncNow` (one at a time per phone); the sync plugin decides when.
import { pendingCount } from '~/offline/outbox'
import { syncNow, type SyncOptions, type SyncReport } from '~/offline/sync'

export interface SyncState {
  running: boolean
  /** Captures on this phone still waiting for the server. */
  pending: number
  /** Last run that pushed (or had nothing to push) without an error (ISO). */
  lastSyncedAt: string | null
  /** From the last run: the push or pull status that stopped it (null = no connection), or undefined if fine. */
  lastError: number | null | undefined
}

export function useSync() {
  const state = useState<SyncState>('sync', () => ({ running: false, pending: 0, lastSyncedAt: null, lastError: undefined }))
  const active = useState('sync:active', () => 0)

  async function refresh() {
    state.value.pending = await pendingCount().catch(() => state.value.pending)
  }

  async function run(options: SyncOptions = {}): Promise<SyncReport | null> {
    // Offline nothing can be answered; don't count failed attempts (that would only lengthen the backoff).
    if (!navigator.onLine) {
      await refresh()
      return null
    }
    active.value++
    state.value.running = true
    try {
      const report = await syncNow(options)
      if (!report.skipped) {
        state.value.lastError = report.pushError !== undefined ? report.pushError : report.pullError
        if (report.pushError === undefined) state.value.lastSyncedAt = new Date().toISOString()
      }
      return report
    }
    finally {
      state.value.running = --active.value > 0
      await refresh()
    }
  }

  return { state, run, refresh }
}
