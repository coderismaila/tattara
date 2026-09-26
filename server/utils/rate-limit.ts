// Route helpers for rate limits: 429 with Retry-After. Counting lives in server/services/rate-limit.ts.
import { createError, setResponseHeader, type H3Event } from 'h3'
import { hitRateLimit, type RateLimitRule } from '../services/rate-limit.ts'
import { useDb } from './db.ts'

export { RATE_LIMITS, hitRateLimit, type RateLimitResult, type RateLimitRule } from '../services/rate-limit.ts'

/** Route helper: 429 with Retry-After when over the limit. */
export async function enforceRateLimit(event: H3Event, key: string, rule: RateLimitRule): Promise<void> {
  const result = await hitRateLimit(useDb(), key, rule)
  if (!result.allowed) throw tooManyRequests(event, result.retryAfterSec)
}

export function tooManyRequests(event: H3Event, retryAfterSec: number) {
  setResponseHeader(event, 'Retry-After', retryAfterSec)
  return createError({ statusCode: 429, statusMessage: 'Too Many Requests', data: { reason: 'rate_limited', retryAfterSec } })
}
