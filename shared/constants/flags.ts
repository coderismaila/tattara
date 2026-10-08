// Flag engine thresholds (PRD R-6, task 5.1). Flags are for review; they never block a save (CLAUDE.md rule 10).

/** Default distance from the PU beyond which a capture's GPS is flagged (runtimeConfig.public.gpsFlagMeters). */
export const DEFAULT_GPS_FLAG_METERS = 3000

/**
 * The limit when the PU's location is a stand-in (ward centroid or polygon point, `units.location_estimated`): the
 * real PU can be kilometres from it, so the normal limit would flag most captures there (ADR-040).
 */
export const GPS_FAR_ESTIMATED_METERS = 10_000

/** A PU is flagged when its supporters exceed this share of its registered voters (as reported by the PU lead). */
export const PU_CAPACITY_RATIO = 0.9

/** More captures than this by one lead within any hour (device clock) is a rate anomaly. */
export const RATE_ANOMALY_PER_HOUR = 60

/** This many supporters (or more) from one lead with exactly the same GPS fix form a cluster. */
export const GPS_CLUSTER_MIN = 10

/** The distance limit for a PU: the configured one, widened when the PU's location is estimated. */
export function gpsFarThreshold(baseMeters: number, puLocationEstimated: boolean): number {
  const base = baseMeters > 0 ? baseMeters : DEFAULT_GPS_FLAG_METERS
  return puLocationEstimated ? Math.max(base, GPS_FAR_ESTIMATED_METERS) : base
}
