// Work that must not hold up a response (task 5.5 fix): the sync push answers the phone first, then raises flags and
// queues thank-you SMS. The Node server keeps running it; errors are logged, never thrown (flags, not blocks).
export function afterResponse(label: string, work: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(work)
    .catch((error: unknown) => {
      console.error(`[${label}] failed after the response:`, error instanceof Error ? error.message : error)
    })
}
