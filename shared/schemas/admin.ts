// Admin request schemas (client form + server route). Messages are i18n keys.
import type { z } from 'zod'
import { inviteSchema } from './team'

/** POST /api/admin/users/dg: the DG has no unit, otherwise the same fields as a team invite. */
export const dgInviteSchema = inviteSchema.omit({ unitCode: true })

export type DgInviteBody = z.infer<typeof dgInviteSchema>
