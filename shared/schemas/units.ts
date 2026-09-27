// Unit request schemas (client forms + server routes). Messages are i18n keys.
import { z } from 'zod'

/** Largest registered-voter figure accepted for one polling unit (big urban PUs are split into voting points). */
export const MAX_REGISTERED_VOTERS = 10_000

/** PUT /api/units/:code/registered-voters */
export const registeredVotersSchema = z.strictObject({
  registeredVoters: z.coerce.number('units.errors.votersInvalid')
    .int('units.errors.votersInvalid')
    .min(0, 'units.errors.votersInvalid')
    .max(MAX_REGISTERED_VOTERS, 'units.errors.votersTooMany'),
})
