// Record IDs are UUIDv7 generated on the client: time-ordered, and the idempotency key for sync (ADR-003).
import { v7 } from 'uuid'

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function newId(): string {
  return v7()
}

export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_RE.test(value)
}
