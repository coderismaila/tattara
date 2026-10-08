// A flag's evidence as a plain sentence (task 5.4): an i18n key under `flag.evidence` and its parameters. Pure.
import type { FlagType } from '~~/shared/constants/enums'

export interface FlagEvidenceText {
  key: string
  params: Record<string, string | number>
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const km = (metres: unknown) => Math.round(num(metres) / 100) / 10

export function flagEvidence(type: FlagType, details: Record<string, unknown>): FlagEvidenceText {
  switch (type) {
    case 'gps_far':
      return {
        key: details.puLocationEstimated ? 'flag.evidence.gps_far_estimated' : 'flag.evidence.gps_far',
        params: { km: km(details.distanceM), limitKm: km(details.thresholdM) },
      }
    case 'duplicate_phone':
      return { key: details.samePu ? 'flag.evidence.duplicate_phone_same_pu' : 'flag.evidence.duplicate_phone', params: { uses: num(details.uses) } }
    case 'pu_over_capacity': {
      const voters = num(details.registeredVoters)
      const supporters = num(details.supporters)
      return {
        key: 'flag.evidence.pu_over_capacity',
        params: { supporters, voters, percent: voters ? Math.round((supporters / voters) * 100) : 100 },
      }
    }
    case 'rate_anomaly':
      return { key: 'flag.evidence.rate_anomaly', params: { count: num(details.count), limit: num(details.limit) } }
    case 'gps_cluster':
      return { key: 'flag.evidence.gps_cluster', params: { size: num(details.clusterSize) } }
    case 'callback_failed':
      return { key: details.outcome === 'denies' ? 'flag.evidence.callback_denies' : 'flag.evidence.callback_wrong_number', params: {} }
    case 'opt_out_spike':
      return { key: 'flag.evidence.opt_out_spike', params: { optOuts: num(details.optOuts), supporters: num(details.supporters), days: num(details.days) } }
  }
}
