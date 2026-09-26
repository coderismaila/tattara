// POST /api/team/:userId/reset-pin — direct children only; sends a new invite link (API.md).
import { defineEventHandler, getRouterParam } from 'h3'
import { resetLeadPin } from '~~/server/services/team'
import { requireAuth } from '~~/server/utils/auth'
import { sendQueuedSmsNow, useAuthConfig } from '~~/server/utils/auth-config'
import { useDb } from '~~/server/utils/db'
import { teamTargetError, userIdParam } from '~~/server/utils/team-http'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuth(event)
  const userId = userIdParam(getRouterParam(event, 'userId'))
  const result = await resetLeadPin(useDb(), user, userId, useAuthConfig(), sendQueuedSmsNow)
  if (result.kind !== 'ok') throw teamTargetError(result.kind)
  return { ok: true }
})
