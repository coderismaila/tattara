// GET /api/sync/pull query (API.md, task 4.3). Error messages are i18n keys.
import { z } from 'zod'
import { isUuidV7 } from '../utils/uuid.ts'

/** Pull pages are keyed by (updated_at in ms, id): `<ms>_<uuid>`. */
export interface PullCursor {
  at: number
  id: string
}

export function encodePullCursor(cursor: PullCursor): string {
  return `${cursor.at}_${cursor.id}`
}

export function decodePullCursor(text: string): PullCursor | null {
  const match = /^(\d{1,15})_([0-9a-f-]{36})$/.exec(text)
  if (!match || !isUuidV7(match[2]!)) return null
  return { at: Number(match[1]), id: match[2]! }
}

export const syncPullQuerySchema = z.object({
  since: z.iso.datetime({ offset: true, error: 'supporter.errors.invalid' }).optional(),
  cursor: z.string().max(60).optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined
      const c = decodePullCursor(v)
      if (!c) {
        ctx.addIssue({ code: 'custom', message: 'supporter.errors.invalid' })
        return z.NEVER
      }
      return c
    }),
})

export type SyncPullQuery = z.output<typeof syncPullQuerySchema>
