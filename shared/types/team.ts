// Shapes returned by GET /api/team (server/services/team.ts) and used by the Team page.
import type { UnitLevel } from '../constants/enums'

export type LeadStatus = 'active' | 'locked' | 'invited'

export interface TeamMember {
  code: string
  name: string
  level: UnitLevel
  lead: null | {
    id: string
    fullName: string
    status: LeadStatus
    /** Full number for the caller's direct children; masked deeper down. */
    phone: string
    lastSeenAt: string | null
  }
  /** PU rows: the registered-voter figure (US-24), NULL until reported. Always NULL above PU level. */
  registeredVoters: number | null
  /** Lead quality score (task 5.5). */
  qualityScore: number | null
}
