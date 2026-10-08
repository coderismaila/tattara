// GET /api/callbacks (API.md, task 5.3).
import type { CallbackOutcome, VerificationStatus } from '../constants/enums'

export interface CallbackItem {
  id: string
  dueDate: string
  /** Still open from an earlier day. */
  overdue: boolean
  outcome: CallbackOutcome | null
  notes: string | null
  completedAt: string | null
  supporter: {
    id: string
    fullName: string
    phone: string
    puCode: string
    capturedAt: string
    verification: VerificationStatus
  }
}

export interface CallbackPassRate {
  days: number
  verified: number
  failed: number
  unreachable: number
  /** verified ÷ (verified + failed), null with no answered calls. */
  rate: number | null
}

export interface CallbackListResponse {
  date: string
  items: CallbackItem[]
  passRate: CallbackPassRate
}
