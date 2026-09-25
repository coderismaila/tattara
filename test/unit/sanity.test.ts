import { describe, expect, it } from 'vitest'

describe('unit test project', () => {
  it('runs in a plain node environment', () => {
    expect(typeof window).toBe('undefined')
  })
})
