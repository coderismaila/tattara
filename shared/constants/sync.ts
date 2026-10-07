// Sync rules shared by the phone's sync engine and the server (task 4.3, ARCHITECTURE §5).

/** Supporters per pull page. A ward's pull pages through; a PU's usually fits in one. */
export const PULL_PAGE_SIZE = 500

/**
 * The pull's `serverTime` is this far before the server's clock, so the next pull overlaps the last one. `updated_at`
 * is the writing transaction's start time, so a write that commits a moment after a pull could otherwise carry a time
 * the pull already passed. Re-applying a record is harmless.
 */
export const PULL_OVERLAP_MS = 2 * 60_000

/** Retry delay after an unanswered push: doubles from this… */
export const PUSH_BACKOFF_BASE_MS = 30_000
/** …up to this (ARCHITECTURE §5: max 30 min). */
export const PUSH_BACKOFF_MAX_MS = 30 * 60_000

/** The engine runs this often while online (plus on start, `online`, after a capture and on Background Sync). */
export const SYNC_INTERVAL_MS = 60_000

/** Background Sync tag the capture page registers and the service worker answers. */
export const SYNC_TAG = 'tattara-push'
/** Web Lock name that keeps tabs and the service worker from pushing at the same time. */
export const SYNC_LOCK = 'tattara-sync'
