// Nitro task `stats:daily` (task 6.1, ARCHITECTURE §7): today's totals per unit for the trend charts.
// Scheduled 23:55 Lagos (22:55 UTC).
import { defineTask } from 'nitropack/runtime'
import { writeDailyStats } from '~~/server/services/stats'
import { useDb } from '~~/server/utils/db'

export default defineTask({
  meta: { name: 'stats:daily', description: 'Snapshot today\'s totals per unit for trend charts' },
  async run() {
    const rows = await writeDailyStats(useDb())
    console.info(`[stats:daily] ${rows} unit rows written`)
    return { result: { rows } }
  },
})
