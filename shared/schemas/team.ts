// Team management request schemas (client forms + server routes). Messages are i18n keys.
import { z } from 'zod'
import { phoneSchema } from './auth'

export const inviteSchema = z.object({
  unitCode: z.string().regex(/^\d{2}(?:\/\d{2}(?:\/\d{2}(?:\/\d{3})?)?)?$/, 'team.errors.unitInvalid'),
  fullName: z.string().trim().min(2, 'team.errors.nameRequired').max(120, 'team.errors.nameTooLong'),
  phone: phoneSchema,
  replace: z.boolean().optional(),
})

export const deactivateSchema = z.object({
  reason: z.string().trim().min(3, 'team.errors.reasonRequired').max(200, 'team.errors.reasonTooLong'),
})

export const teamQuerySchema = z.object({
  unit: z.string().regex(/^\d{2}(?:\/\d{2}(?:\/\d{2})?)?$/, 'team.errors.unitInvalid').optional(),
})

export type InviteBody = z.infer<typeof inviteSchema>
