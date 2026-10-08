// Flag review routes (API.md, task 5.4). Error messages are i18n keys.
import { z } from 'zod'
import { FLAG_TYPES } from '../constants/enums.ts'
import { isValidPuCode } from '../utils/pu-code.ts'
import { containsPhoneNumber } from '../utils/text.ts'
import { isUuidV7 } from '../utils/uuid.ts'

export const FLAG_LIST_DEFAULT_LIMIT = 50
export const FLAG_LIST_MAX_LIMIT = 100

/** Flags page by (created_at in ms, id): `<ms>_<uuid>` (engine flags have v4 ids, so ids alone aren't ordered). */
export interface FlagCursor {
  at: number
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const encodeFlagCursor = (c: FlagCursor) => `${c.at}_${c.id}`

export function decodeFlagCursor(text: string): FlagCursor | null {
  const match = /^(\d{1,15})_(.{36})$/.exec(text)
  if (!match || !(UUID.test(match[2]!) || isUuidV7(match[2]!))) return null
  return { at: Number(match[1]), id: match[2]! }
}

export const flagListQuerySchema = z.object({
  /** open, or reviewed (dismissed + confirmed). */
  status: z.enum(['open', 'reviewed'], 'flag.errors.invalid').default('open'),
  type: z.enum(FLAG_TYPES, 'flag.errors.invalid').optional(),
  /** A unit (or PU) code inside the caller's scope. */
  unit: z.string().refine(isValidPuCode, 'flag.errors.invalid').optional(),
  cursor: z.string().max(60).optional().transform((v, ctx) => {
    if (v === undefined) return undefined
    const c = decodeFlagCursor(v)
    if (!c) {
      ctx.addIssue({ code: 'custom', message: 'flag.errors.invalid' })
      return z.NEVER
    }
    return c
  }),
  limit: z.coerce.number('flag.errors.invalid').int('flag.errors.invalid')
    .min(1, 'flag.errors.invalid').max(FLAG_LIST_MAX_LIMIT, 'flag.errors.invalid')
    .default(FLAG_LIST_DEFAULT_LIMIT),
})

export const flagResolveSchema = z.strictObject({
  status: z.enum(['dismissed', 'confirmed'], 'flag.errors.statusRequired'),
  note: z.string().trim().max(200, 'flag.errors.noteTooLong')
    .refine(v => !containsPhoneNumber(v), 'flag.errors.notePhone')
    .optional()
    .transform(v => v || undefined),
})

export type FlagListQuery = z.output<typeof flagListQuerySchema>
export type FlagResolveInput = z.output<typeof flagResolveSchema>
