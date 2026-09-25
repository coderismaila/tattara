import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import JSON5 from 'json5'

// Rule 8: every user-facing string exists in both ha and en.
const load = (file: string) => JSON5.parse(readFileSync(new URL(`../../i18n/locales/${file}`, import.meta.url), 'utf8'))

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('locale files', () => {
  const ha = load('ha.json5')
  const en = load('en.json')

  it('ha and en have exactly the same keys', () => {
    expect(keys(ha).sort()).toEqual(keys(en).sort())
  })

  it('has no empty strings', () => {
    for (const locale of [ha, en]) {
      for (const key of keys(locale)) {
        const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], locale)
        expect(value, key).toMatch(/\S/)
      }
    }
  })

  it('never uses voter-registration wording', () => {
    const text = JSON.stringify([ha, en]).toLowerCase()
    expect(text).not.toMatch(/register(ing)? voters?|voter registration/)
  })
})
