// Nitro task `stats:reconcile` (task 6.1, ARCHITECTURE §7): rebuild pu_stats from the supporter rows if anything drifted,
// and say so (drift means a write path skipped applyStatDelta: a bug to chase). Scheduled 02:00 UTC.
import { defineTask } from 'nitropack/runtime'
import { reconcilePuStats } from '~~/server/services/stats'
import { useDb } from '~~/server/utils/db'

export default defineTask({
  meta: { name: 'stats:reconcile', description: 'Recompute pu_stats from the supporter rows and report drift' },
  async run() {
    const result = await reconcilePuStats(useDb())
    if (result.drifted) console.warn(`[stats:reconcile] ${result.drifted} PUs had drifted (fixed): ${result.sample.join(', ')}`)
    else console.info('[stats:reconcile] no drift')
    return { result }
  },
})
