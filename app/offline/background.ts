// Browser features around sync (task 4.3, ARCHITECTURE §5): Background Sync (Android Chrome sends queued captures
// even after the app is closed) and persistent storage (so the browser doesn't evict unsent captures when space is low).
import { SYNC_TAG } from '~~/shared/constants/sync'
import { getMeta, setMeta } from './db'

interface SyncManagerLike {
  register: (tag: string) => Promise<void>
}

/** Ask the service worker to sync when the connection is back. No-op without a service worker or Background Sync. */
export async function requestBackgroundSync(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    const sync = (registration as (ServiceWorkerRegistration & { sync?: SyncManagerLike }) | undefined)?.sync
    if (!registration?.active || !sync) return false
    await sync.register(SYNC_TAG)
    return true
  }
  catch {
    return false
  }
}

const PERSISTED_KEY = 'storagePersisted'

/**
 * Ask once per session start for persistent storage and remember the answer (Settings warns when refused). Chrome
 * decides without a prompt: installed apps and well-used sites get it.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  const storage = navigator.storage
  if (!storage?.persist) return null
  try {
    const granted = (await storage.persisted()) || (await storage.persist())
    await setMeta(PERSISTED_KEY, granted)
    return granted
  }
  catch {
    return null
  }
}

/** The last answer: true, false (refused), or undefined (not asked yet / not supported). */
export const getStoragePersisted = () => getMeta<boolean>(PERSISTED_KEY)
