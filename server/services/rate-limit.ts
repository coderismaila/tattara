// Fixed-window rate limits in Postgres (ARCHITECTURE §6): login 5/15 min per phone, OTP sends 3/hour per phone, …
// One atomic upsert per hit, on the DB clock, so limits hold across server instances. Pure (DB injected); the route
// helpers that answer 429 are in server/utils/rate-limit.ts.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'

export interface RateLimitRule {
  limit: number
  windowSec: number
}

export interface RateLimitResult {
  allowed: boolean
  count: number
  /** Seconds until the window resets. */
  retryAfterSec: number
}

export const RATE_LIMITS = {
  // Above the 5-wrong-PIN lockout so the lockout (with its clear message) always triggers first (ADR-024).
  login: { limit: 10, windowSec: 15 * 60 },
  otpSend: { limit: 3, windowSec: 60 * 60 },
  // Per inviter: each invite is an SMS.
  invite: { limit: 100, windowSec: 60 * 60 },
  // Per user (ARCHITECTURE §6): the sync engine pushes ≤ 50 items per request.
  syncPush: { limit: 120, windowSec: 60 },
  // Per user: one pull a minute, plus pages (a ward of ~6,000 supporters is 12 pages on a first pull).
  syncPull: { limit: 60, windowSec: 60 },
  // It tells whether a number is known, so keep it to what a lead typing numbers needs.
  checkPhone: { limit: 60, windowSec: 60 },
} as const satisfies Record<string, RateLimitRule>

/** Keys are hashed so phone numbers are never stored in the clear. */
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

/** Count one hit against `key` and report whether it is within the limit. */
export async function hitRateLimit(db: Db, key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const window = sql`make_interval(secs => ${rule.windowSec})`
  const rows = await db.execute<{ count: number, retry_after: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${hashKey(key)}, now(), 1)
    on conflict (key) do update set
      window_start = case when rate_limits.window_start <= now() - ${window} then now() else rate_limits.window_start end,
      count = case when rate_limits.window_start <= now() - ${window} then 1 else rate_limits.count + 1 end
    returning count, greatest(1, ceil(extract(epoch from (window_start + ${window} - now()))))::int as retry_after
  `)
  const { count, retry_after } = rows[0]!
  return { allowed: count <= rule.limit, count, retryAfterSec: retry_after }
}
