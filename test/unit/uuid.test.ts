import { describe, expect, it } from 'vitest'
import { isUuidV7, newId } from '../../shared/utils/uuid'

describe('newId', () => {
  it('returns a UUIDv7', () => {
    expect(isUuidV7(newId())).toBe(true)
  })

  it('sorts in creation order', () => {
    const ids = Array.from({ length: 1000 }, () => newId())
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('isUuidV7', () => {
  it.each([
    ['v4', '9b2f3c1e-6a7d-4f1b-8c2e-1d3f5a7b9c0e'],
    ['uppercase', '0190F3A2-1C4B-7D8E-9F0A-1B2C3D4E5F60'],
    ['no dashes', '0190f3a21c4b7d8e9f0a1b2c3d4e5f60'],
    ['wrong variant', '0190f3a2-1c4b-7d8e-cf0a-1b2c3d4e5f60'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isUuidV7(value)).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isUuidV7(undefined)).toBe(false)
    expect(isUuidV7(42)).toBe(false)
  })
})
