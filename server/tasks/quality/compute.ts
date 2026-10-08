// Nitro task `quality:compute` (task 5.5, PRD R-7): rebuild every unit's quality score from the last 90 days.
// Scheduled nightly after the flag scan, so the day's new flags count.
import { defineTask } from 'nitropack/runtime'
import { computeQuality } from '~~/server/services/quality'
import { useDb } from '~~/server/utils/db'

export default defineTask({
  meta: {
    name: 'quality:compute',
    description: 'Recompute lead quality scores per unit',
  },
  async run() {
    const scored = await computeQuality(useDb())
    console.info(`[quality:compute] ${scored} units scored`)
    return { result: { scored } }
  },
})
