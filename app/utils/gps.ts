// Silent GPS helpers (UX §4.1: capture location in the background, never block saving). Pure, unit-tested.
import type { GpsFix } from '~~/shared/types/supporter'

/** A fix older than this is not attached to a new supporter. */
export const GPS_MAX_AGE_MS = 2 * 60 * 1000

export interface TimedFix extends GpsFix {
  /** Epoch ms when the device took the reading. */
  at: number
}

export function toTimedFix(position: Pick<GeolocationPosition, 'coords' | 'timestamp'>): TimedFix {
  const { latitude, longitude, accuracy } = position.coords
  return {
    lat: Math.round(latitude * 1e6) / 1e6,
    lng: Math.round(longitude * 1e6) / 1e6,
    accuracyM: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    at: position.timestamp,
  }
}

/** The fix to store with a capture made at `now`, or null when there is none recent enough. */
export function freshFix(fix: TimedFix | null, now: number): GpsFix | null {
  if (!fix || now - fix.at > GPS_MAX_AGE_MS || fix.at - now > GPS_MAX_AGE_MS) return null
  return { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM }
}
