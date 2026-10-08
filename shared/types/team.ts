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
  /** Quality score 0–100 of the unit's last 90 days (task 5.5); NULL with too little data. */
  qualityScore: number | null
  /** What the score is made of; NULL when the unit had no supporters in the window. Aggregates only. */
  quality: TeamQuality | null
}

export interface TeamQuality {
  verifiedRate: number
  flagRate: number
  optOutRate: number
  passRate: number | null
  supporters: number
  computedAt: string
}
