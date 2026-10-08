// Calendar days in Africa/Lagos (WAT, UTC+1 all year: Nigeria has no daylight saving). Dates are `YYYY-MM-DD`.
// Used where "a day" matters to people: the daily call-back sample (5.3), and later daily stats.

const LAGOS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The Lagos calendar date of an instant. */
export function lagosDate(at: Date = new Date()): string {
  return LAGOS.format(at)
}

/** `date` plus `days` (negative to go back). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}
