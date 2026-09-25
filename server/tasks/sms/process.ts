// Nitro task `sms:process`: sends due messages from sms_queue. Scheduled every minute (nuxt.config
// nitro.scheduledTasks); routes that need speed (OTP, 2.4) also run it right after enqueueing.
import { defineTask } from 'nitropack/runtime'
import { processSmsQueue } from '~~/server/services/sms'
import { useDb } from '~~/server/utils/db'
import { getSmsProvider } from '~~/server/utils/sms'

export default defineTask({
  meta: {
    name: 'sms:process',
    description: 'Send due messages from sms_queue (retries with backoff)',
  },
  async run() {
    const result = await processSmsQueue(useDb(), getSmsProvider())
    if (result.claimed > 0) {
      console.info(`[sms:process] claimed ${result.claimed}: sent ${result.sent}, retrying ${result.retrying}, failed ${result.failed}`)
    }
    return { result }
  },
})
