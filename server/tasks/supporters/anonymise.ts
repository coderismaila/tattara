// Nitro task `supporters:anonymise` (task 5.2, US-18): anonymise removal requests (lead requests and SMS STOPs) and
// clear their SMS rows. Scheduled hourly, well inside the 72-hour deadline.
import { defineTask } from 'nitropack/runtime'
import { runAnonymisation } from '~~/server/services/supporter-sms'
import { useDb } from '~~/server/utils/db'

export default defineTask({
  meta: {
    name: 'supporters:anonymise',
    description: 'Anonymise supporters who asked to be removed (within 72 h)',
  },
  async run() {
    const result = await runAnonymisation(useDb())
    if (result.anonymised || result.smsDeleted) {
      console.info(`[supporters:anonymise] anonymised ${result.anonymised}, deleted ${result.smsDeleted} SMS rows`)
    }
    return { result }
  },
})
