// GET /api/flags (API.md, task 5.4).
import type { FlagStatus, FlagType } from '../constants/enums'
import type { MaskedSupporterDto, SupporterDto } from './supporter'

/** Who or what a flag is about. Supporters are full for ward leads and masked above (SECURITY_PRIVACY §3). */
export type FlagSubject
  = | { kind: 'supporter', supporter: SupporterDto | MaskedSupporterDto }
    | { kind: 'lead', lead: { id: string, fullName: string, unitCode: string | null } | null }
    | { kind: 'pu' }

export interface FlagDto {
  id: string
  type: FlagType
  status: FlagStatus
  puCode: string
  createdAt: string
  /** Evidence only (distances, counts, ratios). */
  details: Record<string, unknown>
  subject: FlagSubject
  reviewedAt: string | null
  reviewedBy: { fullName: string } | null
  reviewNote: string | null
}

export interface FlagListResponse {
  items: FlagDto[]
  nextCursor: string | null
  /** Open flags by type in the same scope and unit (for the filter chips). */
  openCounts: Partial<Record<FlagType, number>>
}
