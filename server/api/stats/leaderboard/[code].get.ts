// GET /api/stats/leaderboard/:code?level=&metric=&limit= → the units at one level below :code, ranked (API.md, task 6.5).
// Default: one level down, by supporters captured in the last 7 days. Aggregates only (admin included); cached 60 s.
import { createError, defineEventHandler } from 'h3'
import { defineCachedFunction } from 'nitropack/runtime'
import { leaderboard } from '~~/server/services/activity'
import { leaderboardQuerySchema } from '~~/shared/schemas/stats'
import type { UnitLevel } from '~~/shared/constants/enums'
import type { LeaderboardMetric } from '~~/shared/types/stats'
import { useDb } from '~~/server/utils/db'
import { statsCode } from '~~/server/utils/stats-http'
import { readValidatedQuery } from '~~/server/utils/validate'

const cachedLeaderboard = defineCachedFunction(
  (code: string, level: UnitLevel | undefined, metric: LeaderboardMetric, limit: number) => leaderboard(useDb(), code, level, metric, limit),
  { name: 'stats-leaderboard', maxAge: 60, getKey: (code: string, level?: string, metric?: string, limit?: number) => `${code || 'all'}:${level ?? '-'}:${metric}:${limit}` },
)

export default defineEventHandler(async (event) => {
  const code = await statsCode(event)
  const { level, metric, limit } = readValidatedQuery(event, leaderboardQuerySchema)
  const board = await cachedLeaderboard(code, level, metric, limit)
  if (board === 'bad_level') throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { reason: 'invalid' } })
  if (!board) throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { reason: 'not_found' } })
  return board
})
