// Supporter SMS (task 5.2, PRD US-9 and US-18, ADR-041): the thank-you after sync, delivery reports that verify the
// number, STOP replies that opt the number out, and the hourly anonymisation of removal requests. Pure (DB injected).
// Phone numbers are never logged or audited; opt-outs are stored only as an HMAC of the number.
import { createHmac } from 'node:crypto'
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import type { Db, DbLike } from '../db/client.ts'
import { smsOptOuts, smsQueue, supporters } from '../db/schema/index.ts'
import type { ConsentLanguage } from '../../shared/constants/enums.ts'
import { SUPPORTER_SMS_TEXT, type SupporterSmsOptions } from '../../shared/constants/sms-text.ts'
import { recordAudit } from './audit.ts'
import { flagAfterWrite } from './flags.ts'
import { enqueueSms } from './sms.ts'
import { anonymiseRequested, consentLanguageForPhone, optOutPhone, verifyPhoneBySms } from './supporters.ts'

export interface SupporterSmsConfig extends SupporterSmsOptions {
  /** NUXT_PHONE_HASH_SECRET (≥ 32 chars). */
  phoneHashSecret: string
}

/** At most one thank-you per number in this window (a shared household phone gets one, not three). */
export const THANK_YOU_WINDOW_HOURS = 24
/** At most one STOP confirmation per number in this window (repeated STOPs don't loop). */
export const OPT_OUT_CONFIRM_WINDOW_HOURS = 24
const SYSTEM = { id: null, role: null, ip: null } as const

export function phoneHash(phone: string, secret: string): string {
  if (secret.length < 32) throw new Error('NUXT_PHONE_HASH_SECRET must be set (at least 32 characters). See .env.example.')
  return createHmac('sha256', secret).update(phone).digest('hex')
}

export async function isOptedOut(db: DbLike, phone: string, secret: string): Promise<boolean> {
  const [row] = await db.select({ h: smsOptOuts.phoneHash }).from(smsOptOuts).where(eq(smsOptOuts.phoneHash, phoneHash(phone, secret)))
  return !!row
}

async function sentRecently(db: DbLike, phone: string, purpose: 'thank_you' | 'opt_out_confirm', hours: number): Promise<boolean> {
  const [row] = await db.select({ id: smsQueue.id }).from(smsQueue).where(and(
    eq(smsQueue.toPhone, phone),
    eq(smsQueue.purpose, purpose),
    ne(smsQueue.status, 'failed'),
    gt(smsQueue.createdAt, sql`now() - ${hours} * interval '1 hour'`),
  )).limit(1)
  return !!row
}

/**
 * Queue the thank-you for supporters a sync just accepted, in the language consent was given in. Skipped for
 * opted-out numbers and numbers thanked in the last 24 h. Returns how many were queued.
 */
export async function queueThankYous(db: Db, supporterIds: readonly string[], config: SupporterSmsConfig): Promise<number> {
  if (!supporterIds.length) return 0
  const rows = await db.select({ id: supporters.id, phone: supporters.phone, puCode: supporters.puCode, language: supporters.consentLanguage })
    .from(supporters)
    .where(and(inArray(supporters.id, [...supporterIds]), eq(supporters.status, 'active')))
  let queued = 0
  for (const row of rows) {
    if (!row.phone) continue
    if (await isOptedOut(db, row.phone, config.phoneHashSecret)) continue
    if (await sentRecently(db, row.phone, 'thank_you', THANK_YOU_WINDOW_HOURS)) continue
    await enqueueSms(db, {
      to: row.phone,
      body: SUPPORTER_SMS_TEXT.thankYou[row.language](config),
      purpose: 'thank_you',
      templateKey: `thank_you.v1.${row.language}`,
      scopeCode: row.puCode,
      supporterId: row.id,
    })
    queued++
  }
  return queued
}

/**
 * A delivery report: the message becomes delivered or failed (only from `sent`; reports can repeat or arrive out of
 * order). A delivered thank-you verifies its number's supporters. Returns false for an unknown message.
 */
export async function applyDeliveryReport(db: Db, providerRef: string, status: 'delivered' | 'failed'): Promise<boolean> {
  const [msg] = await db.update(smsQueue)
    .set({ status, lastError: status === 'failed' ? 'delivery report: failed' : null })
    .where(and(eq(smsQueue.providerRef, providerRef), eq(smsQueue.status, 'sent')))
    .returning({ toPhone: smsQueue.toPhone, purpose: smsQueue.purpose })
  if (!msg) return false
  if (status === 'delivered' && msg.purpose === 'thank_you') await verifyPhoneBySms(db, msg.toPhone)
  return true
}

export interface OptOutResult {
  /** Supporter records opted out (0 for a number we hold no live record for; it is still blocked). */
  optedOut: number
  confirmationQueued: boolean
}

/**
 * A STOP from `phone`: block the number (hash), opt out and queue for anonymisation every live record on it (audited
 * by id), raise opt-out flags, and confirm once.
 */
export async function handleStop(db: Db, phone: string, config: SupporterSmsConfig): Promise<OptOutResult> {
  await db.insert(smsOptOuts).values({ phoneHash: phoneHash(phone, config.phoneHashSecret) }).onConflictDoNothing()
  const language: ConsentLanguage = (await consentLanguageForPhone(db, phone)) ?? 'ha'
  const changed = await optOutPhone(db, phone)
  for (const row of changed) {
    await recordAudit(db, SYSTEM, {
      action: 'supporter.opt_out',
      targetType: 'supporter',
      targetId: row.id,
      scopeCode: row.puCode,
      meta: { via: 'sms_stop' },
    })
  }
  await flagAfterWrite(db, changed.map(r => r.id))

  let confirmationQueued = false
  if (!(await sentRecently(db, phone, 'opt_out_confirm', OPT_OUT_CONFIRM_WINDOW_HOURS))) {
    await enqueueSms(db, {
      to: phone,
      body: SUPPORTER_SMS_TEXT.optOutConfirm[language](config),
      purpose: 'opt_out_confirm',
      templateKey: `opt_out_confirm.v1.${language}`,
    })
    confirmationQueued = true
  }
  return { optedOut: changed.length, confirmationQueued }
}

/**
 * The hourly job: anonymise every removal request (lead requests and STOPs), then delete finished supporter SMS
 * (thank-you, STOP confirmation) to numbers no live supporter uses any more, so the queue keeps no trace of them.
 * Audited as counts only.
 */
export async function runAnonymisation(db: Db): Promise<{ anonymised: number, smsDeleted: number }> {
  let anonymised = 0
  for (;;) {
    const batch = await anonymiseRequested(db)
    anonymised += batch.length
    if (batch.length < 500) break
  }

  // Finished supporter SMS to numbers no live supporter uses (just anonymised, or left from an earlier run while a
  // confirmation was still queued). One statement: the not-exists uses the supporters phone index.
  const deleted = await db.execute<{ id: string }>(sql`
    delete from sms_queue q
    where q.purpose in ('thank_you', 'opt_out_confirm') and q.status <> 'queued'
      and not exists (select 1 from supporters s where s.phone = q.to_phone and s.status <> 'anonymised')
    returning q.id`)
  const smsDeleted = deleted.length
  if (anonymised || smsDeleted) {
    await recordAudit(db, SYSTEM, { action: 'supporter.anonymise', targetType: 'supporter', meta: { anonymised, smsDeleted } })
  }
  return { anonymised, smsDeleted }
}
