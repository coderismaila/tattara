// POST /api/auth/setup { token, pin, deviceId } → invite accepted, PIN set, device trusted, session started (API.md)
import { createError, defineEventHandler } from 'h3'
import { completeSetup } from '~~/server/services/auth'
import { setupSchema } from '~~/shared/schemas/auth'
import { startSession } from '~~/server/utils/auth'
import { useDb } from '~~/server/utils/db'
import { readValidated } from '~~/server/utils/validate'

export default defineEventHandler(async (event) => {
  const input = await readValidated(event, setupSchema)
  const result = await completeSetup(useDb(), input)
  switch (result.kind) {
    case 'ok':
      await startSession(event, result.user, input.deviceId)
      return { ok: true }
    case 'invalid':
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invite_invalid' } })
    case 'expired':
      throw createError({ statusCode: 410, statusMessage: 'Gone', data: { reason: 'invite_expired' } })
    case 'unit_taken':
      throw createError({ statusCode: 409, statusMessage: 'Conflict', data: { reason: 'unit_taken' } })
  }
})
