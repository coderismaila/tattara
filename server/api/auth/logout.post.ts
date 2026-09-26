// POST /api/auth/logout → session cleared. The client wipes its local data (task 4.5).
import { defineEventHandler } from 'h3'
import { endSession } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  await endSession(event)
  return { ok: true }
})
