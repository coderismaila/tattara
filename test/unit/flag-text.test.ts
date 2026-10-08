// Task 5.4: every flag type's evidence becomes a sentence key that exists in both languages, with its numbers.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSON5 from 'json5'
import { describe, expect, it } from 'vitest'
import { FLAG_TYPES } from '../../shared/constants/enums'
import { flagEvidence } from '../../app/utils/flag-text'

const ROOT = join(import.meta.dirname, '../..')
const en = JSON.parse(readFileSync(join(ROOT, 'i18n/locales/en.json'), 'utf8'))
const ha = JSON5.parse(readFileSync(join(ROOT, 'i18n/locales/ha.json5'), 'utf8'))
const lookup = (messages: Record<string, unknown>, key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages)

describe('flagEvidence', () => {
  it('turns the engine\'s evidence into sentence parameters', () => {
    expect(flagEvidence('gps_far', { distanceM: 6234, thresholdM: 3000, puLocationEstimated: false })).toEqual({ key: 'flag.evidence.gps_far', params: { km: 6.2, limitKm: 3 } })
    expect(flagEvidence('gps_far', { distanceM: 12000, thresholdM: 10000, puLocationEstimated: true }).key).toBe('flag.evidence.gps_far_estimated')
    expect(flagEvidence('duplicate_phone', { uses: 3, samePu: true })).toEqual({ key: 'flag.evidence.duplicate_phone_same_pu', params: { uses: 3 } })
    expect(flagEvidence('pu_over_capacity', { supporters: 460, registeredVoters: 500 }).params).toEqual({ supporters: 460, voters: 500, percent: 92 })
    expect(flagEvidence('rate_anomaly', { count: 80, limit: 60 }).params).toEqual({ count: 80, limit: 60 })
    expect(flagEvidence('gps_cluster', { clusterSize: 25 }).params).toEqual({ size: 25 })
    expect(flagEvidence('callback_failed', { outcome: 'denies' }).key).toBe('flag.evidence.callback_denies')
    expect(flagEvidence('callback_failed', { outcome: 'wrong_number' }).key).toBe('flag.evidence.callback_wrong_number')
    expect(flagEvidence('opt_out_spike', { optOuts: 6, supporters: 40, days: 7 }).params).toEqual({ optOuts: 6, supporters: 40, days: 7 })
  })

  it('never breaks on missing evidence', () => {
    for (const type of FLAG_TYPES) expect(() => flagEvidence(type, {})).not.toThrow()
    expect(flagEvidence('pu_over_capacity', {}).params.percent).toBe(100)
  })

  it('every key it can return exists in Hausa and English, as does every type label', () => {
    const keys = new Set<string>()
    for (const type of FLAG_TYPES) {
      for (const details of [{}, { puLocationEstimated: true }, { samePu: true }, { outcome: 'denies' }, { outcome: 'wrong_number' }]) {
        keys.add(flagEvidence(type, details).key)
      }
      keys.add(`flag.types.${type}`)
    }
    for (const key of keys) {
      expect(typeof lookup(en, key), `en ${key}`).toBe('string')
      expect(typeof lookup(ha, key), `ha ${key}`).toBe('string')
    }
  })
})
