// Offline PIN check for the idle lock (SECURITY_PRIVACY §7). PBKDF2-SHA256 via WebCrypto with a random salt; the PIN
// itself is never stored. A 6-digit PIN can't resist an offline brute force of a copied database whatever the
// iteration count, so the real protection is the attempt limit in the app (5 wrong → wipe); the iterations only slow
// a copy down. The server's argon2id hash stays the authority for online sign-in.

export const PIN_VERIFIER_ITERATIONS = 600_000

export interface PinVerifier {
  v: 1
  salt: string
  hash: string
  iterations: number
}

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function createPinVerifier(pin: string, iterations = PIN_VERIFIER_ITERATIONS): Promise<PinVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { v: 1, salt: toBase64(salt), hash: toBase64(await derive(pin, salt, iterations)), iterations }
}

export async function verifyPin(pin: string, verifier: PinVerifier): Promise<boolean> {
  const actual = await derive(pin, fromBase64(verifier.salt), verifier.iterations)
  const expected = fromBase64(verifier.hash)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!
  return diff === 0
}
