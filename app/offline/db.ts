// The on-device database (ARCHITECTURE §5, DATA_MODEL §6). 4.5 needs only `meta` (the local session and the PIN
// verifier); 4.2 adds supporters, outbox and units as version 2. Everything here is wiped on sign-out, after too
// many wrong PINs, and when the server says the session was revoked (SECURITY_PRIVACY §7).
import Dexie, { type EntityTable } from 'dexie'
import { LAST_ACTIVE_STORAGE_KEY } from './idle'

export const DB_NAME = 'tattara'

export interface MetaRow {
  key: string
  value: unknown
}

export class TattaraDb extends Dexie {
  meta!: EntityTable<MetaRow, 'key'>

  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores({ meta: 'key' })
  }
}

export const db = new TattaraDb()

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

/** Delete everything Tattara keeps on this phone. The database reopens empty on next use. */
export async function wipeDevice(): Promise<void> {
  await db.delete({ disableAutoOpen: false })
  try {
    localStorage.removeItem(LAST_ACTIVE_STORAGE_KEY)
  }
  catch {
    // Storage blocked: nothing stored there either.
  }
}
