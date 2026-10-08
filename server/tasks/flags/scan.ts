// Nitro task `flags:scan` (task 5.1): run every flag check over the whole registry. Scheduled nightly (nuxt.config
// nitro.scheduledTasks); syncs and edits already check their own records, so this catches cross-record patterns that
// grew from other leads' captures, and anything a failed after-write check missed.
import { defineTask, useRuntimeConfig } from 'nitropack/runtime'
import { runFlagChecks } from '~~/server/services/flags'
import { useDb } from '~~/server/utils/db'

export default defineTask({
  meta: {
    name: 'flags:scan',
    description: 'Run the data-quality flag checks over all supporters',
  },
  async run() {
    const result = await runFlagChecks(useDb(), { gpsFlagMeters: Number(useRuntimeConfig().public.gpsFlagMeters) })
    console.info(`[flags:scan] new flags: ${Object.entries(result).map(([type, n]) => `${type} ${n}`).join(', ')}`)
    return { result }
  },
})
