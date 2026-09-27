// Supporter schemas, shared by the capture form, the sync engine and the server routes (CLAUDE.md: Zod in
// shared/schemas). Error messages are i18n keys. Objects are strict: an unknown key (say `pvcNumber` or `nin`) is
// rejected, not silently dropped, so no new sensitive field can sneak in through the API (CLAUDE.md rule 3).
import { z } from 'zod'
import { AGE_BANDS, CONSENT_LANGUAGES, GENDERS, HAS_PVC, SUPPORT_LEVELS } from '../constants/enums.ts'
import { CONSENT_VERSIONS, consentLanguageOf } from '../constants/consent.ts'
import { isValidPuCode, unitLevel } from '../utils/pu-code.ts'
import { isUuidV7 } from '../utils/uuid.ts'
import { phoneSchema } from './auth.ts'

/** Consent may be recorded at most this long after the capture time (both come from the same phone clock). */
export const CONSENT_AFTER_CAPTURE_TOLERANCE_MS = 60_000

// ── Field schemas ───────────────────────────────────────────────────────────

const fullName = z.string()
  .transform(v => v.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(2, 'supporter.errors.nameRequired').max(120, 'supporter.errors.nameTooLong'))

/** Free text / landmark; blank → null. */
const address = z.string()
  .transform(v => v.trim().replace(/\s+/g, ' '))
  .pipe(z.string().max(200, 'supporter.errors.addressTooLong'))
  .transform(v => v || null)

const gender = z.enum(GENDERS, 'supporter.errors.invalid')
const ageBand = z.enum(AGE_BANDS, 'supporter.errors.invalid')
const supportLevel = z.enum(SUPPORT_LEVELS, 'supporter.errors.supportRequired')
const hasPvc = z.enum(HAS_PVC, 'supporter.errors.pvcRequired')
const flag = z.boolean('supporter.errors.invalid')

/** The fields the lead fills in on the capture form (UX §4.1). Optional ones come out as null. */
export const supporterFieldsSchema = z.strictObject({
  fullName,
  phone: phoneSchema,
  sharedPhone: flag.default(false),
  address: address.nullish().transform(v => v ?? null),
  gender: gender.nullish().transform(v => v ?? null),
  ageBand: ageBand.nullish().transform(v => v ?? null),
  supportLevel,
  hasPvc,
  volunteer: flag.default(false),
})

/** The capture form: the fields plus the consent tick, which must be ticked. */
export const supporterFormSchema = supporterFieldsSchema.extend({
  consentGiven: z.literal(true, 'supporter.errors.consentRequired'),
})

// ── What the phone sends (sync push, 4.3) ───────────────────────────────────

const isoDateTime = z.iso.datetime({ offset: true, error: 'supporter.errors.invalid' })

export const gpsFixSchema = z.strictObject({
  lat: z.number('supporter.errors.gpsInvalid').min(-90, 'supporter.errors.gpsInvalid').max(90, 'supporter.errors.gpsInvalid'),
  lng: z.number('supporter.errors.gpsInvalid').min(-180, 'supporter.errors.gpsInvalid').max(180, 'supporter.errors.gpsInvalid'),
  accuracyM: z.number('supporter.errors.gpsInvalid').min(0, 'supporter.errors.gpsInvalid').max(100_000, 'supporter.errors.gpsInvalid').nullable(),
})

/** A captured supporter as synced to the server. Output type = SupporterInput (shared/types/supporter.ts). */
export const supporterInputSchema = supporterFieldsSchema.extend({
  id: z.string().refine(isUuidV7, 'supporter.errors.invalid'),
  puCode: z.string().refine(c => isValidPuCode(c) && unitLevel(c) === 'pu', 'supporter.errors.puInvalid'),
  consentAt: isoDateTime,
  consentVersion: z.enum(CONSENT_VERSIONS, 'supporter.errors.consentRequired'),
  consentLanguage: z.enum(CONSENT_LANGUAGES, 'supporter.errors.consentRequired'),
  gps: gpsFixSchema.nullish().transform(v => v ?? null),
  capturedAt: isoDateTime,
  deviceId: z.uuid('supporter.errors.invalid'),
}).superRefine((s, ctx) => {
  if (consentLanguageOf(s.consentVersion) !== s.consentLanguage) {
    ctx.addIssue({ code: 'custom', path: ['consentLanguage'], message: 'supporter.errors.consentRequired' })
  }
  if (Date.parse(s.consentAt) > Date.parse(s.capturedAt) + CONSENT_AFTER_CAPTURE_TOLERANCE_MS) {
    ctx.addIssue({ code: 'custom', path: ['consentAt'], message: 'supporter.errors.consentAfterCapture' })
  }
})

// ── Edits (US-8) ────────────────────────────────────────────────────────────

/**
 * PATCH body: editable fields only (the PU, consent and capture details are fixed). Omitted = unchanged;
 * null clears an optional field.
 */
export const supporterPatchSchema = z.strictObject({
  fullName: fullName.optional(),
  phone: phoneSchema.optional(),
  sharedPhone: flag.optional(),
  address: address.nullable().optional(),
  gender: gender.nullable().optional(),
  ageBand: ageBand.nullable().optional(),
  supportLevel: supportLevel.optional(),
  hasPvc: hasPvc.optional(),
  volunteer: flag.optional(),
}).refine(p => Object.values(p).some(v => v !== undefined), 'supporter.errors.nothingToSave')

export type SupporterFields = z.infer<typeof supporterFieldsSchema>
export type SupporterForm = z.input<typeof supporterFormSchema>

// ── Sync push (API.md) ──────────────────────────────────────────────────────

export const SYNC_PUSH_MAX_ITEMS = 50

/** The batch envelope only: each item is validated on its own, so one bad record doesn't reject the others. */
export const syncPushSchema = z.strictObject({
  items: z.array(z.unknown(), 'supporter.errors.invalid')
    .min(1, 'supporter.errors.invalid')
    .max(SYNC_PUSH_MAX_ITEMS, 'supporter.errors.tooManyItems'),
})
export type SupporterFormOutput = z.output<typeof supporterFormSchema>

// ── List and removal (3.4) ──────────────────────────────────────────────────

export const SUPPORTER_LIST_DEFAULT_LIMIT = 50
export const SUPPORTER_LIST_MAX_LIMIT = 200

/** GET /api/supporters query: search text (name, full phone or ≥ 4 trailing digits), PU filter, cursor, limit. */
export const supporterListQuerySchema = z.object({
  q: z.string().trim().max(80, 'supporter.errors.invalid').optional().transform(v => v || undefined),
  pu: z.string().refine(c => isValidPuCode(c) && unitLevel(c) === 'pu', 'supporter.errors.puInvalid').optional(),
  cursor: z.string().refine(isUuidV7, 'supporter.errors.invalid').optional(),
  limit: z.coerce.number('supporter.errors.invalid').int('supporter.errors.invalid')
    .min(1, 'supporter.errors.invalid').max(SUPPORTER_LIST_MAX_LIMIT, 'supporter.errors.invalid')
    .default(SUPPORTER_LIST_DEFAULT_LIMIT),
})

/** POST /api/supporters/:id/removal: the reason goes to the audit log (no phone numbers). */
export const removalRequestSchema = z.strictObject({
  reason: z.string().trim().min(3, 'supporter.errors.reasonRequired').max(200, 'supporter.errors.reasonTooLong'),
})

export type SupporterListQuery = z.output<typeof supporterListQuerySchema>

/** GET /api/supporters/check-phone?phone= */
export const checkPhoneQuerySchema = z.object({ phone: phoneSchema })
