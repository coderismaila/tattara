// Shapes returned by the admin routes (server/services/admin.ts) and used by the Admin page.
import type { LeadStatus } from './team'

export interface DgSummary {
  id: string
  fullName: string
  status: LeadStatus
  /** Masked: the admin sits above ward level (SECURITY_PRIVACY §3). */
  phone: string
  lastSeenAt: string | null
}
