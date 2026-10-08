// Call-back routes (API.md, task 5.3). Error messages are i18n keys.
import { z } from 'zod'
import { CALLBACK_OUTCOMES } from '../constants/enums.ts'
import { isIsoDate } from '../utils/lagos-date.ts'

/** Looks like a Nigerian phone number (E.164 or local), spaces and dashes allowed. */
const PHONE_LIKE = /(?:\+?234|\b0)[\s-]*[789][\s-]*[01](?:[\s-]*\d){8}/

export const callbackListQuerySchema = z.object({
  date: z.string().refine(isIsoDate, 'callback.errors.invalid').optional(),
})

export const callbackOutcomeSchema = z.strictObject({
  outcome: z.enum(CALLBACK_OUTCOMES, 'callback.errors.outcomeRequired'),
  notes: z.string().trim().max(200, 'callback.errors.notesTooLong')
    .refine(v => !PHONE_LIKE.test(v), 'callback.errors.notesPhone')
    .optional()
    .transform(v => v || undefined),
})

export type CallbackOutcomeInput = z.output<typeof callbackOutcomeSchema>
