// Target request schemas (task 6.4, PRD US-15). Client forms + server routes. Messages are i18n keys.
import { z } from 'zod'

/** Largest target accepted for one unit (Kano, the biggest state, has ~6M registered voters). */
export const MAX_TARGET = 10_000_000

/** PUT /api/targets/:code */
export const targetSchema = z.strictObject({
  target: z.coerce.number('targets.errors.invalid')
    .int('targets.errors.invalid')
    .min(0, 'targets.errors.invalid')
    .max(MAX_TARGET, 'targets.errors.tooBig'),
})

/** POST /api/targets/:code/distribute. `preview` returns the split without saving it. */
export const distributeSchema = z.strictObject({
  method: z.literal('proportional', 'targets.errors.invalid').default('proportional'),
  preview: z.boolean('targets.errors.invalid').default(false),
})

export type TargetInput = z.output<typeof targetSchema>
export type DistributeInput = z.output<typeof distributeSchema>
