// SMS queue: enqueue outbound messages; process due ones through a provider with retries and backoff.
// Delivery is at-least-once: a worker that dies mid-send leaves the message to be retried after its lease.
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { smsQueue, type SmsQueueRow } from '../db/schema/index.ts'
import type { SmsPurpose } from '../../shared/constants/enums.ts'
import { normalizePhone } from '../../shared/utils/phone.ts'
import { SmsSendError, type SmsProvider } from '../utils/sms/types.ts'

export const SMS_MAX_ATTEMPTS = 5
const BACKOFF_BASE_MS = 30_000
const BACKOFF_MAX_MS = 60 * 60_000
/** How long a claimed message is hidden from other workers while being sent. */
export const SMS_LEASE_MS = 5 * 60_000

/**
 * Bodies that carry secrets (OTP codes, invite tokens) are replaced once the message is finished, so the queue
 * never keeps them readable at rest (SECURITY §5 requires OTPs and invite tokens to be hashed at rest).
 */
export const SMS_REDACTED_PURPOSES: readonly SmsPurpose[] = ['otp', 'invite']
export const SMS_REDACTED_BODY = '[redacted]'
const finishedBody = (purpose: SmsPurpose) =>
  SMS_REDACTED_PURPOSES.includes(purpose) ? { body: SMS_REDACTED_BODY } : {}

/** Delay before retry number `attempt` (1-based): 30 s, 1 min, 2 min, 4 min… capped at 1 h. */
export function smsBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS)
}

export class InvalidSmsRecipientError extends Error {
  override name = 'InvalidSmsRecipientError'
}

export interface EnqueueSmsInput {
  to: string
  body: string
  purpose: SmsPurpose
  templateKey?: string
  scopeCode?: string
  createdBy?: string
}

export async function enqueueSms(db: Db, input: EnqueueSmsInput): Promise<SmsQueueRow> {
  const to = normalizePhone(input.to)
  if (!to) throw new InvalidSmsRecipientError('Recipient is not a valid Nigerian mobile number')
  const [row] = await db.insert(smsQueue).values({
    toPhone: to,
    body: input.body,
    purpose: input.purpose,
    templateKey: input.templateKey,
    scopeCode: input.scopeCode,
    createdBy: input.createdBy,
  }).returning()
  return row!
}

export interface ProcessResult {
  claimed: number
  sent: number
  retrying: number
  failed: number
}

export interface ProcessOptions {
  batchSize?: number
  /**
   * Fixed clock for tests. When omitted, all time arithmetic uses the database clock (`now()`), the same clock
   * that stamps `next_attempt_at` on insert; mixing it with the app server's clock made fresh messages look
   * not-yet-due whenever the DB clock ran slightly ahead.
   */
  now?: Date
}

/** `now + ms` on the chosen clock. */
const at = (now: Date | undefined, ms: number) =>
  now ? new Date(now.getTime() + ms) : sql`now() + ${ms} * interval '1 millisecond'`

/** Claim due messages (skipping ones other workers hold) and send them. */
export async function processSmsQueue(db: Db, provider: SmsProvider, options: ProcessOptions = {}): Promise<ProcessResult> {
  const { now } = options
  const batchSize = options.batchSize ?? 50
  const leaseUntil = at(now, SMS_LEASE_MS)

  const due = db.select({ id: smsQueue.id }).from(smsQueue)
    .where(and(eq(smsQueue.status, 'queued'), lte(smsQueue.nextAttemptAt, now ?? sql`now()`)))
    .orderBy(smsQueue.nextAttemptAt)
    .limit(batchSize)
    .for('update', { skipLocked: true })

  const claimed = await db.update(smsQueue)
    .set({ nextAttemptAt: leaseUntil })
    .where(inArray(smsQueue.id, due))
    .returning()

  const result: ProcessResult = { claimed: claimed.length, sent: 0, retrying: 0, failed: 0 }

  for (const msg of claimed) {
    const attempts = msg.attempts + 1
    try {
      const { providerRef } = await provider.send({ to: msg.toPhone, body: msg.body, purpose: msg.purpose })
      await db.update(smsQueue).set({
        status: 'sent',
        ...finishedBody(msg.purpose),
        attempts,
        providerRef,
        sentAt: now ?? sql`now()`,
        nextAttemptAt: null,
        lastError: null,
      }).where(eq(smsQueue.id, msg.id))
      result.sent++
    }
    catch (error) {
      const retryable = error instanceof SmsSendError ? error.retryable : true
      const giveUp = !retryable || attempts >= SMS_MAX_ATTEMPTS
      // Error text only: provider messages never contain the body; never log the phone (SECURITY §8).
      const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500)
      await db.update(smsQueue).set({
        status: giveUp ? 'failed' : 'queued',
        ...(giveUp ? finishedBody(msg.purpose) : {}),
        attempts,
        lastError,
        nextAttemptAt: giveUp ? null : at(now, smsBackoffMs(attempts)),
      }).where(eq(smsQueue.id, msg.id))
      if (giveUp) result.failed++
      else result.retrying++
    }
  }

  return result
}

/** Count of queued messages that are due (for the task's log line and health checks). */
export async function countDueSms(db: Db, now?: Date): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(smsQueue)
    .where(and(eq(smsQueue.status, 'queued'), lte(smsQueue.nextAttemptAt, now ?? sql`now()`)))
  return row?.n ?? 0
}
