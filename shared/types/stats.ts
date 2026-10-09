// /api/stats/* (API.md, task 6.1). Aggregates only: never names or phones.
import type { UnitLevel } from '../constants/enums'

export interface RegisteredVotersAggregate {
  /** Sum over PUs with a reported figure; NULL when none has one. */
  sum: number | null
  pusWithFigure: number
  totalPus: number
}

export interface UnitStats {
  unit: { code: string, name: string, level: UnitLevel | 'region' }
  totals: {
    supporters: number
    verified: number
    flaggedOpen: number
    optedOut: number
    volunteers: number
    hasPvcYes: number
    support: { strong: number, leaning: number, undecided: number }
    gender: { male: number, female: number }
    age: { '18_24': number, '25_34': number, '35_44': number, '45_54': number, '55_64': number, '65_plus': number }
  }
  registeredVoters: RegisteredVotersAggregate
  /** Supporters on PUs with a figure ÷ those PUs' registered voters (ADR-033); NULL with no figures. */
  coverage: number | null
  target: number | null
  /** supporters ÷ target; NULL without a target. */
  progress: number | null
  lastCaptureAt: string | null
  /** Oldest first; days without a snapshot are left out. */
  last30Days: { day: string, total: number, verified: number }[]
  computedAt: string
}

export const CHILD_METRICS = ['coverage', 'supporters', 'verifiedRate', 'flaggedOpen', 'progress', 'activeLeads'] as const
export type ChildMetric = typeof CHILD_METRICS[number]

export interface ChildStats {
  code: string
  name: string
  level: UnitLevel
  supporters: number
  verified: number
  verifiedRate: number | null
  flaggedOpen: number
  registeredVoters: RegisteredVotersAggregate
  coverage: number | null
  target: number | null
  progress: number | null
  /** Active leads in the child unit and everything under it. */
  activeLeads: number
}

export interface ChildrenStats {
  unit: { code: string, level: UnitLevel | 'region' }
  metric: ChildMetric
  sort: 'asc' | 'desc'
  children: ChildStats[]
  computedAt: string
}

/** Leaderboard rankings (task 6.5, ADR-049). `recent` = supporters captured in the last LEADERBOARD_WINDOW_DAYS days. */
export const LEADERBOARD_METRICS = ['recent', 'progress', 'coverage'] as const
export type LeaderboardMetric = typeof LEADERBOARD_METRICS[number]
export const LEADERBOARD_WINDOW_DAYS = 7

export interface LeaderboardRow {
  rank: number
  code: string
  name: string
  /** The ranked metric; NULL ranks last (no target / no registered-voter figures). */
  value: number | null
  recent: number
  supporters: number
  progress: number | null
  coverage: number | null
}

export interface Leaderboard {
  unit: { code: string, level: UnitLevel | 'region' }
  level: UnitLevel
  metric: LeaderboardMetric
  /** Units ranked (before `limit`). */
  total: number
  rows: LeaderboardRow[]
  computedAt: string
}

/** An active PU lead with no captures in the window (task 6.5). Lead names only: no phone numbers. */
export interface InactiveLead {
  userId: string
  name: string
  unitCode: string
  unitName: string
  /** NULL: never captured. */
  lastCaptureAt: string | null
  lastSeenAt: string | null
  /** Whole days since the last capture, or since setting up when there is none. */
  daysInactive: number
}

/** A lead invited but never set up (task 6.5): any role below the caller. */
export interface NotStartedLead {
  userId: string
  name: string
  role: string
  unitCode: string
  unitName: string
  invitedAt: string
  daysSinceInvite: number
}

export interface InactiveLeads {
  unit: { code: string, level: UnitLevel | 'region' }
  days: number
  inactive: InactiveLead[]
  inactiveTotal: number
  notStarted: NotStartedLead[]
  notStartedTotal: number
  computedAt: string
}
