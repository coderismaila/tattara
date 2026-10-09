// Target route responses (task 6.4, API.md). Aggregates only.

/** What a proportional split was weighted by: reported registered voters, or PU count when figures are missing. */
export type SplitBasis = 'registered_voters' | 'pu_count'

export interface SetTargetResult {
  code: string
  target: number
  previous: number | null
}

export interface TargetSplitRow {
  code: string
  name: string
  /** Registered voters or active PUs, per `basis`. */
  weight: number
  target: number
  previous: number | null
}

export interface DistributeResult {
  code: string
  target: number
  basis: SplitBasis
  children: TargetSplitRow[]
  /** false for a preview. */
  saved: boolean
}
