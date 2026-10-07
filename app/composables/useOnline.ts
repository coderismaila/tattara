// Whether the phone has a connection (navigator.onLine, kept current by the online/offline events).
export function useOnline() {
  const online = useState('online', () => true)
  if (import.meta.client) {
    onMounted(() => {
      online.value = navigator.onLine
      const update = () => (online.value = navigator.onLine)
      window.addEventListener('online', update)
      window.addEventListener('offline', update)
      onBeforeUnmount(() => {
        window.removeEventListener('online', update)
        window.removeEventListener('offline', update)
      })
    })
  }
  return online
}
