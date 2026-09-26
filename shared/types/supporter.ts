// Supporter shapes shared by the capture form, the sync engine and the server (3.2 adds the Zod schema).
import type {
  AgeBand,
  ConsentLanguage,
  Gender,
  HasPvc,
  SupporterStatus,
  SupportLevel,
  VerificationStatus,
} from '../constants/enums'

export interface GpsFix {
  lat: number
  lng: number
  /** Metres, as reported by the device. */
  accuracyM: number | null
}

/** A new supporter as captured on the phone. `id` is a client UUIDv7; dates are ISO strings. */
export interface SupporterInput {
  id: string
  puCode: string
  fullName: string
  /** E.164. */
  phone: string
  sharedPhone: boolean
  address: string | null
  gender: Gender | null
  ageBand: AgeBand | null
  supportLevel: SupportLevel
  hasPvc: HasPvc
  volunteer: boolean
  consentAt: string
  consentVersion: string
  consentLanguage: ConsentLanguage
  gps: GpsFix | null
  capturedAt: string
  deviceId: string
}

/** Fields a PU lead may edit later (US-8). PU, consent and capture details are fixed. */
export const SUPPORTER_EDITABLE_FIELDS = [
  'fullName',
  'phone',
  'sharedPhone',
  'address',
  'gender',
  'ageBand',
  'supportLevel',
  'hasPvc',
  'volunteer',
] as const
export type SupporterEditableField = typeof SUPPORTER_EDITABLE_FIELDS[number]
export type SupporterPatch = Partial<Pick<SupporterInput, SupporterEditableField>>

/** Full record: PU and ward leads in scope only (SECURITY_PRIVACY §3). */
export interface SupporterDto {
  masked: false
  id: string
  puCode: string
  fullName: string
  /** NULL once anonymised. */
  phone: string | null
  sharedPhone: boolean
  address: string | null
  gender: Gender | null
  ageBand: AgeBand | null
  supportLevel: SupportLevel
  hasPvc: HasPvc
  volunteer: boolean
  consentAt: string
  consentVersion: string
  consentLanguage: ConsentLanguage
  gps: GpsFix | null
  capturedAt: string
  capturedBy: string
  verification: VerificationStatus
  status: SupporterStatus
  createdAt: string
  updatedAt: string
}

/** Everyone else (flag review): initials and a masked phone, no address or GPS. */
export interface MaskedSupporterDto {
  masked: true
  id: string
  puCode: string
  /** e.g. `M. G.` */
  initials: string
  /** e.g. `+234 80* *** 4567`; NULL once anonymised. */
  phone: string | null
  capturedAt: string
  verification: VerificationStatus
  status: SupporterStatus
}
