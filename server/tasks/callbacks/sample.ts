// Nitro task `callbacks:sample` (task 5.3, US-10): each ward's random 5% of yesterday's new supporters to call back
// today (and any day of the last week a run missed). Scheduled 05:00 Lagos (04:00 UTC).
import { defineTask } from 'nitropack/runtime'
import { sampleCallbacks } from '~~/server/services/callbacks'
import { lagosDate } from '~~/shared/utils/lagos-date'
import { useDb } from '~~/server/utils/db'

export default defineTask({
  meta: {
    name: 'callbacks:sample',
    description: 'Draw the daily call-back sample for every ward',
  },
  async run() {
    const created = await sampleCallbacks(useDb(), lagosDate())
    console.info(`[callbacks:sample] ${created} calls created`)
    return { result: { created } }
  },
})
