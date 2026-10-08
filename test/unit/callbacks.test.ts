// Task 5.3: Lagos calendar days (the sample is per Lagos day) and the call-back input rules.
import { describe, expect, it } from 'vitest'
import { callbackListQuerySchema, callbackOutcomeSchema } from '../../shared/schemas/callbacks'
import { addDays, isIsoDate, lagosDate } from '../../shared/utils/lagos-date'

describe('lagosDate', () => {
  it('is UTC+1 all year: 23:30 UTC is already the next day in Lagos', () => {
    expect(lagosDate(new Date('2026-10-07T22:59:59Z'))).toBe('2026-10-07')
    expect(lagosDate(new Date('2026-10-07T23:00:00Z'))).toBe('2026-10-08')
    expect(lagosDate(new Date('2026-03-29T23:30:00Z'))).toBe('2026-03-30') // no daylight saving
  })

  it('addDays crosses months and years', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('isIsoDate accepts real dates only', () => {
    expect(isIsoDate('2026-10-08')).toBe(true)
    for (const bad of ['2026-02-30', '2026-1-8', '08/10/2026', '', null, 20261008]) expect(isIsoDate(bad)).toBe(false)
  })
})

describe('callback schemas', () => {
  it('an outcome is required; notes are optional, trimmed, ≤ 200 chars', () => {
    expect(callbackOutcomeSchema.parse({ outcome: 'verified' })).toEqual({ outcome: 'verified' })
    expect(callbackOutcomeSchema.parse({ outcome: 'denies', notes: '  Said a neighbour signed him up  ' }))
      .toEqual({ outcome: 'denies', notes: 'Said a neighbour signed him up' })
    expect(callbackOutcomeSchema.parse({ outcome: 'unreachable', notes: '   ' })).toEqual({ outcome: 'unreachable' })
    expect(callbackOutcomeSchema.safeParse({}).error?.issues[0]?.message).toBe('callback.errors.outcomeRequired')
    expect(callbackOutcomeSchema.safeParse({ outcome: 'maybe' }).success).toBe(false)
    expect(callbackOutcomeSchema.safeParse({ outcome: 'verified', notes: 'x'.repeat(201) }).error?.issues[0]?.message).toBe('callback.errors.notesTooLong')
    expect(callbackOutcomeSchema.safeParse({ outcome: 'verified', extra: 1 }).success).toBe(false)
  })

  it.each(['Call his son on 0803 123 4567', 'new number +2348031234567', 'try 08031234567'])('notes with a phone number are refused: %s', (notes) => {
    expect(callbackOutcomeSchema.safeParse({ outcome: 'wrong_number', notes }).error?.issues[0]?.message).toBe('callback.errors.notesPhone')
  })

  it('the list date is optional and must be a real day', () => {
    expect(callbackListQuerySchema.parse({})).toEqual({})
    expect(callbackListQuerySchema.safeParse({ date: '2026-13-01' }).success).toBe(false)
  })
})
