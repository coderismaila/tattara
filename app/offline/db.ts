// The on-device database (ARCHITECTURE §5, DATA_MODEL §6). Version 1 (4.5): `meta` (the local session and the PIN
// verifier). Version 2 (4.2): supporters captured on this phone, the outbox of writes to send, and the lead's units.
// Everything here is wiped on sign-out, after too many wrong PINs, and when the server says the session was revoked
// (SECURITY_PRIVACY §7).
import Dexie, { type EntityTable } from 'dexie'
import type { SupporterStatus, UnitLevel, VerificationStatus } from '~~/shared/constants/enums'
import type { SupporterInput, SyncItemResult } from '~~/shared/types/supporter'
import { LAST_ACTIVE_STORAGE_KEY } from './idle'

export const DB_NAME = 'tattara'

export interface MetaRow {
  key: string
  value: unknown
}

export type LocalSyncStatus = 'pending' | 'synced' | 'rejected'
export type LocalRejectReason = Extract<SyncItemResult, { result: 'rejected' }>['reason'] | 'conflict'

/**
 * A supporter as this phone holds it: captured here (`deviceId` set) or brought by the pull (4.3: the lead's PU, or a
 * ward lead's ward, with the server's status), plus where it stands with the server.
 */
export interface LocalSupporter extends Omit<SupporterInput, 'deviceId'> {
  deviceId?: string
  status?: SupporterStatus
  verification?: VerificationStatus
  syncStatus: LocalSyncStatus
  rejectReason?: LocalRejectReason
  /** Field paths and i18n keys only, never values (as the server sends them). */
  issues?: { path: string, message: string }[]
  serverUpdatedAt?: string
}

/** One write waiting for the server. 4.2 only creates; edits join as another kind. */
export interface OutboxRow {
  seq?: number
  id: string
  kind: 'create'
  payload: SupporterInput
  createdAt: string
  attempts: number
  /** ISO time before which the sync engine does not retry (backoff after unanswered pushes; `force` ignores it). */
  nextAttemptAt: string
}

/** The lead's own subtree (PU and ward leads), for offline names. Replaced by each full pull (4.3). */
export interface LocalUnit {
  code: string
  parentCode: string | null
  name: string
  level: UnitLevel
  active?: boolean
}

export class TattaraDb extends Dexie {
  meta!: EntityTable<MetaRow, 'key'>
  supporters!: EntityTable<LocalSupporter, 'id'>
  outbox!: EntityTable<OutboxRow, 'seq'>
  units!: EntityTable<LocalUnit, 'code'>

  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores({ meta: 'key' })
    this.version(2).stores({
      supporters: 'id, puCode, phone, syncStatus, capturedAt',
      outbox: '++seq, id, kind, createdAt, attempts, nextAttemptAt',
      units: 'code, parentCode',
    })
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
