// GET /api/admin/dg: the active DG, else the pending DG invite, else null. ADMIN only.
import { defineEventHandler } from 'h3'
import { currentDg } from '~~/server/services/admin'
import { requireAdmin } from '~~/server/utils/admin'
import { useDb } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { dg: await currentDg(useDb()) }
})
