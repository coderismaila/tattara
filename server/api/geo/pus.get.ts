// GET /api/geo/pus?ward=19-05-03 → { ward, points } (API.md, task 6.3): the PU points of one ward for the map.
// Anyone whose scope holds the ward (admin included: aggregates). Cached for 60 s per ward.
import { createError, defineEventHandler, getQuery } from 'h3'
import { defineCachedFunction } from 'nitropack/runtime'
import { puPoints } from '~~/server/services/geo'
import { fromUrlCode, unitLevel } from '~~/shared/utils/pu-code'
import { useDb } from '~~/server/utils/db'
import { getScope, requireScope } from '~~/server/utils/scope'

const cachedPoints = defineCachedFunction((ward: string) => puPoints(useDb(), ward), {
  name: 'geo-pus',
  maxAge: 60,
  getKey: (ward: string) => ward,
})

export default defineEventHandler(async (event) => {
  const raw = getQuery(event).ward
  const ward = typeof raw === 'string' ? fromUrlCode(raw.replaceAll('/', '-')) : null
  if (!ward || unitLevel(ward) !== 'ward') {
    await getScope(event) // 401 before 400 when signed out
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid' } })
  }
  await requireScope(event, ward, { allowAdmin: true })
  return { ward, points: await cachedPoints(ward) }
})
