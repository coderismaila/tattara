// A stable id for this phone/browser (ARCHITECTURE §6: an unknown deviceId needs an SMS OTP).
// localStorage is fine here: it's not supporter data (SECURITY §7).
import { newId } from '~~/shared/utils/uuid'

export const DEVICE_ID_STORAGE_KEY = 'tattara:deviceId'

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY)
    if (existing) return existing
    const id = newId()
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, id)
    return id
  }
  catch {
    // Storage blocked (private mode): a per-page-load id still works, the user just gets an OTP each time.
    return newId()
  }
}
