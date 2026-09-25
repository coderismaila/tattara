// PIN hashing (SECURITY_PRIVACY §5): argon2id, memory ≥ 19 MiB. Never log PINs.
// Runtime-agnostic (no Nitro imports): used by auth routes, the admin CLI and the dev seed.
import { hash, verify, type Algorithm } from '@node-rs/argon2'

// Algorithm is an ambient const enum (not importable as a value under verbatimModuleSyntax): 2 = Argon2id.
const ARGON2ID = 2 as Algorithm.Argon2id

// OWASP minimum for argon2id: m=19 MiB, t=2, p=1.
export const PIN_HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPin(pin: string): Promise<string> {
  return hash(pin, PIN_HASH_OPTIONS)
}

/** Constant-time verify. Returns false (never throws) for a malformed stored hash. */
export async function verifyPin(storedHash: string, pin: string): Promise<boolean> {
  try {
    return await verify(storedHash, pin)
  }
  catch {
    return false
  }
}
