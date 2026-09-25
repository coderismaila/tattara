import { describe, expect, it } from 'vitest'
import { hashPin, verifyPin } from '../../server/utils/pin'

describe('PIN hashing', () => {
  it('hashes with argon2id at ≥ 19 MiB, t=2, p=1', async () => {
    const hash = await hashPin('123456')
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
  })

  it('verifies the right PIN and rejects a wrong one', async () => {
    const hash = await hashPin('482915')
    expect(await verifyPin(hash, '482915')).toBe(true)
    expect(await verifyPin(hash, '482916')).toBe(false)
    expect(await verifyPin(hash, '')).toBe(false)
  })

  it('salts: the same PIN hashes differently each time', async () => {
    expect(await hashPin('123456')).not.toBe(await hashPin('123456'))
  })

  it('returns false instead of throwing on a malformed stored hash', async () => {
    expect(await verifyPin('not-a-hash', '123456')).toBe(false)
  })
})
