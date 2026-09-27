// Watches the device location while the capture page is open. Never prompts twice, never blocks: if the lead
// declines or there is no signal, supporters are simply saved without GPS (PRD R-4).
import { freshFix, toTimedFix, type TimedFix } from '~/utils/gps'

export type GpsStatus = 'waiting' | 'ok' | 'denied' | 'unavailable'

export function useSilentGps() {
  const fix = shallowRef<TimedFix | null>(null)
  const status = ref<GpsStatus>('waiting')
  let watchId: number | null = null

  onMounted(() => {
    if (!('geolocation' in navigator)) {
      status.value = 'unavailable'
      return
    }
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        fix.value = toTimedFix(position)
        status.value = 'ok'
      },
      (error) => {
        // Keep an earlier fix on a timeout; permission denied is final for this page.
        if (error.code === error.PERMISSION_DENIED) status.value = 'denied'
        else if (!fix.value) status.value = 'unavailable'
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    )
  })

  onBeforeUnmount(() => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  })

  /** The fix for a capture happening now (null if none is recent). */
  const current = () => freshFix(fix.value, Date.now())

  return { fix: readonly(fix), status: readonly(status), current }
}
