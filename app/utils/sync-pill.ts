// What the sync status pill says (UX §2.3, §4.5): calm in every state, never red just for being offline.

export interface SyncPillInput {
  online: boolean
  running: boolean
  pending: number
  rejected: number
}

export interface SyncPillView {
  /** i18n key under `sync.pill`, pluralised by `count`. */
  key: 'rejected' | 'offline' | 'sending' | 'waiting' | 'allSent'
  count: number
  icon: string
  /** neutral for normal states, success when everything is sent, warning when the lead must act. */
  tone: 'neutral' | 'success' | 'warning'
}

/** Refusals come first (the lead has something to fix); then offline, sending, waiting, all sent. */
export function syncPillView({ online, running, pending, rejected }: SyncPillInput): SyncPillView {
  if (rejected > 0) return { key: 'rejected', count: rejected, icon: 'i-lucide-triangle-alert', tone: 'warning' }
  if (!online) return { key: 'offline', count: pending, icon: 'i-lucide-smartphone', tone: 'neutral' }
  if (running && pending > 0) return { key: 'sending', count: pending, icon: 'i-lucide-refresh-cw', tone: 'neutral' }
  if (pending > 0) return { key: 'waiting', count: pending, icon: 'i-lucide-clock', tone: 'neutral' }
  return { key: 'allSent', count: 0, icon: 'i-lucide-check', tone: 'success' }
}
