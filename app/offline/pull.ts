// Keep the lead's unit current on the phone from GET /api/sync/pull (task 4.3, ARCHITECTURE §5 step 6): supporters
// changed since the last pull, the unit subtree and its totals. Only PU and ward leads pull (SECURITY_PRIVACY §7: a PU
// lead holds their own PU, a ward lead their ward). Captures still waiting for the server are never overwritten.
import type { SupporterDto } from '~~/shared/types/supporter'
import type { PullResponse, PullStats } from '~~/shared/types/sync'
import { isWithin } from '~~/shared/utils/pu-code'
import { db, getMeta, setMeta, type LocalSupporter } from './db'

/** Fetches one page. Throws on no answer, with `statusCode` when the server answered with an error. */
export type PullGet = (query: { since?: string, cursor?: string }) => Promise<PullResponse>

export const nuxtGet: PullGet = query => $fetch<PullResponse>('/api/sync/pull', { query })

/** The phone was wiped or another lead signed in while a pull was in flight: nothing more may be written. */
export class PullSessionGone extends Error {
  constructor() {
    super('local session changed during the pull')
  }
}

/** Inside a write transaction (with `meta`): stop unless the same lead is still signed in on this phone. */
async function assertSession(userId: string) {
  const session = (await db.meta.get('session'))?.value as { userId?: string } | undefined
  if (session?.userId !== userId) throw new PullSessionGone()
}

const LAST_PULL_KEY = 'lastPullAt'
const PULL_UNIT_KEY = 'pullUnit'
const STATS_KEY = 'pullStats'

export const getPullStats = () => getMeta<PullStats & { at: string }>(STATS_KEY)
export const getLastPullAt = () => getMeta<string>(LAST_PULL_KEY)

function toLocal(dto: SupporterDto, serverUpdatedAt: string): LocalSupporter {
  return {
    id: dto.id,
    puCode: dto.puCode,
    fullName: dto.fullName,
    phone: dto.phone ?? '',
    sharedPhone: dto.sharedPhone,
    address: dto.address,
    gender: dto.gender,
    ageBand: dto.ageBand,
    supportLevel: dto.supportLevel,
    hasPvc: dto.hasPvc,
    volunteer: dto.volunteer,
    consentAt: dto.consentAt,
    consentVersion: dto.consentVersion as LocalSupporter['consentVersion'],
    consentLanguage: dto.consentLanguage,
    gps: dto.gps,
    capturedAt: dto.capturedAt,
    status: dto.status,
    verification: dto.verification,
    syncStatus: 'synced',
    serverUpdatedAt,
  }
}

/**
 * Apply one page. The server's copy replaces ours unless we still owe the server something for that record (it's in
 * the outbox) or the server refused ours (kept for the Sync screen). Tombstones remove anonymised records. Nothing is
 * written unless `userId` is still the phone's lead (a wipe during the request must stay a wipe).
 */
export async function applyPull(page: PullResponse, userId: string): Promise<void> {
  await db.transaction('rw', db.supporters, db.outbox, db.units, db.meta, async () => {
    await assertSession(userId)
    const queued = new Set(await db.outbox.orderBy('id').uniqueKeys() as string[])
    for (const item of page.supporters) {
      if (queued.has(item.id)) continue
      const local = await db.supporters.get(item.id)
      if (local?.syncStatus === 'rejected') continue
      if ('deleted' in item) await db.supporters.delete(item.id)
      else await db.supporters.put(toLocal(item, item.updatedAt))
    }
    if (page.units.length) {
      await db.units.clear()
      await db.units.bulkPut(page.units)
    }
    await setMeta(STATS_KEY, { ...page.stats, at: page.serverTime })
  })
}

/**
 * Pull every page since the last complete pull. A lead moved to another unit starts over: synced records outside the
 * new unit and the old units leave the phone first. `lastPullAt` moves only once all pages are in, so a pull cut short
 * repeats (harmlessly) next time.
 */
export async function pullAll(userId: string, unitCode: string, get: PullGet = nuxtGet): Promise<void> {
  let since = await getLastPullAt()
  if ((await getMeta<string>(PULL_UNIT_KEY)) !== unitCode) {
    await db.transaction('rw', db.supporters, db.units, db.meta, async () => {
      await assertSession(userId)
      await db.supporters.where('syncStatus').equals('synced').filter(s => !isWithin(s.puCode, unitCode)).delete()
      await db.units.clear()
      await db.meta.delete(LAST_PULL_KEY)
      await setMeta(PULL_UNIT_KEY, unitCode)
    })
    since = undefined
  }
  let cursor: string | undefined
  let serverTime: string | undefined
  do {
    const page = await get({ since, cursor })
    serverTime ??= page.serverTime
    await applyPull(page, userId)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  await db.transaction('rw', db.meta, async () => {
    await assertSession(userId)
    await setMeta(LAST_PULL_KEY, serverTime)
  })
}
