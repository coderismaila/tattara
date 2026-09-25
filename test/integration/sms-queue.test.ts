import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../../server/db/client'
import { runMigrations } from '../../server/db/migrate'
import { smsQueue } from '../../server/db/schema'
import { InvalidSmsRecipientError, SMS_MAX_ATTEMPTS, SMS_REDACTED_BODY, enqueueSms, processSmsQueue, smsBackoffMs } from '../../server/services/sms'
import { SmsSendError, type SmsMessage, type SmsProvider } from '../../server/utils/sms/types'
import { createTempDatabase, isDbReachable } from './helpers/db'
import { pgErrorCode } from './helpers/pg-error'

const dbAvailable = await isDbReachable()
if (process.env.CI && !dbAvailable) {
  throw new Error('CI must run integration tests: database is not reachable.')
}

/** Records sends; optionally fails with the given error. */
function provider(fail?: () => Error, delayMs = 0): SmsProvider & { sent: SmsMessage[] } {
  const sent: SmsMessage[] = []
  return {
    name: 'test',
    sent,
    async send(m) {
      if (delayMs) await new Promise(r => setTimeout(r, delayMs))
      if (fail) throw fail()
      sent.push(m)
      return { providerRef: `ref-${sent.length}` }
    },
  }
}

describe.skipIf(!dbAvailable)('sms queue', () => {
  let temp: Awaited<ReturnType<typeof createTempDatabase>>
  let db: Db
  let close: () => Promise<void>
  const row = async (id: string) => (await db.select().from(smsQueue).where(eq(smsQueue.id, id)))[0]!

  beforeAll(async () => {
    temp = await createTempDatabase()
    await runMigrations(temp.url)
    const conn = createDb(temp.url, { max: 6 })
    db = conn.db
    close = () => conn.client.end()
  })

  beforeEach(async () => {
    await db.delete(smsQueue)
  })

  afterAll(async () => {
    await close?.()
    await temp?.drop()
  })

  it('normalises the recipient and rejects invalid numbers', async () => {
    const queued = await enqueueSms(db, { to: '0803 123 4567', body: 'Hi', purpose: 'otp' })
    expect(queued).toMatchObject({ toPhone: '+2348031234567', status: 'queued', attempts: 0 })
    await expect(enqueueSms(db, { to: '012345678', body: 'Hi', purpose: 'otp' })).rejects.toBeInstanceOf(InvalidSmsRecipientError)
    // The DB enforces it too.
    expect(await pgErrorCode(db.insert(smsQueue).values({ toPhone: '08031234567', body: 'x', purpose: 'otp' }))).toBe('23514')
  })

  it('sends due messages and records the provider reference', async () => {
    const q = await enqueueSms(db, { to: '+2348031234567', body: 'Code 111111', purpose: 'otp' })
    const p = provider()
    expect(await processSmsQueue(db, p)).toEqual({ claimed: 1, sent: 1, retrying: 0, failed: 0 })
    expect(p.sent).toEqual([{ to: '+2348031234567', body: 'Code 111111', purpose: 'otp' }])
    expect(await row(q.id)).toMatchObject({ status: 'sent', attempts: 1, providerRef: 'ref-1', nextAttemptAt: null })
    expect((await row(q.id)).sentAt).toBeInstanceOf(Date)
    // Nothing left to do.
    expect(await processSmsQueue(db, p)).toMatchObject({ claimed: 0 })
  })

  it('redacts OTP and invite bodies once finished, keeps others', async () => {
    const otp = await enqueueSms(db, { to: '+2348031234567', body: 'Code 222222', purpose: 'otp' })
    const thanks = await enqueueSms(db, { to: '+2348031234568', body: 'Mun gode!', purpose: 'thank_you' })
    const invite = await enqueueSms(db, { to: '+2348031234569', body: 'Setup code 9F3K', purpose: 'invite' })
    await processSmsQueue(db, provider())
    expect((await row(otp.id)).body).toBe(SMS_REDACTED_BODY)
    expect((await row(thanks.id)).body).toBe('Mun gode!')
    expect((await row(invite.id)).body).toBe(SMS_REDACTED_BODY)

    // Also when an OTP finally fails; but a queued retry keeps its body so it can be resent.
    const failing = await enqueueSms(db, { to: '+2348031234567', body: 'Code 333333', purpose: 'otp' })
    await processSmsQueue(db, provider(() => new SmsSendError('Termii HTTP 503', true)))
    expect((await row(failing.id)).body).toBe('Code 333333')
    await processSmsQueue(db, provider(() => new SmsSendError('Termii HTTP 400', false)), { now: new Date(Date.now() + 3_600_000) })
    expect(await row(failing.id)).toMatchObject({ status: 'failed', body: SMS_REDACTED_BODY })
  })

  it('retries transient errors with backoff, then gives up after the max attempts', async () => {
    const q = await enqueueSms(db, { to: '+2348031234567', body: 'Hello', purpose: 'thank_you' })
    const flaky = provider(() => new SmsSendError('Termii HTTP 503', true))
    // Start a minute ahead of the DB's insert time so the message is due on the first run.
    let now = new Date(Date.now() + 60_000)

    for (let attempt = 1; attempt < SMS_MAX_ATTEMPTS; attempt++) {
      expect(await processSmsQueue(db, flaky, { now })).toMatchObject({ retrying: 1 })
      const r = await row(q.id)
      expect(r).toMatchObject({ status: 'queued', attempts: attempt, lastError: 'Termii HTTP 503' })
      expect(r.nextAttemptAt!.getTime()).toBe(now.getTime() + smsBackoffMs(attempt))
      // Not due yet: a run 1 s before the backoff ends claims nothing.
      expect(await processSmsQueue(db, flaky, { now: new Date(r.nextAttemptAt!.getTime() - 1000) })).toMatchObject({ claimed: 0 })
      now = r.nextAttemptAt!
    }
    expect(await processSmsQueue(db, flaky, { now })).toMatchObject({ failed: 1 })
    expect(await row(q.id)).toMatchObject({ status: 'failed', attempts: SMS_MAX_ATTEMPTS, nextAttemptAt: null })
  })

  it('fails permanent errors at once', async () => {
    const q = await enqueueSms(db, { to: '+2348031234567', body: 'Hello', purpose: 'invite' })
    await processSmsQueue(db, provider(() => new SmsSendError('Termii HTTP 400: invalid number', false)))
    expect(await row(q.id)).toMatchObject({ status: 'failed', attempts: 1, lastError: 'Termii HTTP 400: invalid number' })
  })

  it('never lets two concurrent processors send the same message', async () => {
    for (let i = 0; i < 20; i++) {
      await enqueueSms(db, { to: `+23480312345${String(i).padStart(2, '0')}`, body: `m${i}`, purpose: 'otp' })
    }
    const a = provider(undefined, 5)
    const b = provider(undefined, 5)
    const [ra, rb] = await Promise.all([
      processSmsQueue(db, a, { batchSize: 12 }),
      processSmsQueue(db, b, { batchSize: 12 }),
    ])
    expect(ra.sent + rb.sent).toBe(20)
    const bodies = [...a.sent, ...b.sent].map(m => m.body)
    expect(new Set(bodies).size).toBe(20)
    const rows = await db.select().from(smsQueue)
    expect(rows.every(r => r.status === 'sent' && r.attempts === 1)).toBe(true)
  })
})
