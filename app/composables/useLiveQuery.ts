// A Dexie live query as a ref (task 4.4): re-runs whenever the tables it read change, in this tab, another tab or the
// service worker. Starts on mount, stops on unmount; `initial` until the first answer (or if the query fails).
import { liveQuery } from 'dexie'

export function useLiveQuery<T>(query: () => Promise<T>, initial: T) {
  const value = shallowRef<T>(initial)
  let subscription: { unsubscribe: () => void } | null = null
  onMounted(() => {
    subscription = liveQuery(query).subscribe({
      next: (v) => {
        value.value = v
      },
      error: () => {},
    })
  })
  onBeforeUnmount(() => subscription?.unsubscribe())
  return value
}
