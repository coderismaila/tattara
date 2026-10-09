// Targets (task 6.4, PRD US-15, ADR-048): the DG sets state targets, every other lead sets the targets of the units
// directly below their own, and may split their own target across them in one go. Children's targets may add up to
// more or less than the parent's (the page shows the gap). Pure (DB injected).
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { unitTargets, units } from '../db/schema/index.ts'
import { MAX_TARGET } from '../../shared/schemas/targets.ts'
import type { SessionUser } from '../../shared/types/auth.ts'
import type { DistributeResult, SetTargetResult, SplitBasis, TargetSplitRow } from '../../shared/types/targets.ts'
import { isValidPuCode, parentCode, unitLevel } from '../../shared/utils/pu-code.ts'
import { recordAudit } from './audit.ts'
import { CHILD_CODE_LENGTH, rollup, targetsFor } from './stats.ts'

type Caller = Pick<SessionUser, 'id' | 'role' | 'unitCode'>

/** DG: a state. Ward, LGA and state leads: a unit directly below their own. Nobody else. */
export function canSetTarget(caller: Pick<Caller, 'role' | 'unitCode'>, code: string): boolean {
  if (!isValidPuCode(code)) return false
  if (caller.role === 'DG') return unitLevel(code) === 'state'
  if (caller.role === 'ADMIN' || caller.role === 'PU_LEAD' || !caller.unitCode) return false
  return parentCode(code) === caller.unitCode
}

/** Only the lead of the unit itself, and only above PU level (the DG's region has no target to split). */
export function canDistribute(caller: Pick<Caller, 'role' | 'unitCode'>, code: string): boolean {
  if (!isValidPuCode(code) || unitLevel(code) === 'pu') return false
  if (caller.role === 'ADMIN' || caller.role === 'DG' || caller.role === 'PU_LEAD') return false
  return caller.unitCode === code
}

/**
 * Split `total` in proportion to `weights` (largest remainder): whole numbers that add up to `total` exactly.
 * Ties in the remainder go to the earlier entry. All-zero weights split evenly.
 */
export function splitProportional(total: number, weights: readonly number[]): number[] {
  if (!weights.length) return []
  const sum = weights.reduce((a, b) => a + b, 0)
  const w = sum > 0 ? weights : weights.map(() => 1)
  const wSum = sum > 0 ? sum : weights.length
  const exact = w.map(x => (total * x) / wSum)
  const out = exact.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i]! += 1
    left -= 1
  }
  return out
}

interface ChildFigures {
  voters: number | null
  pusWithFigure: number
  totalPus: number
}

/**
 * Registered voters when every child's PUs have all reported a figure (and there is at least one); otherwise PU count
 * for all of them. Mixing the two would weigh a child by a partial sum (ADR-033).
 */
export function chooseBasis(children: readonly ChildFigures[]): SplitBasis {
  const complete = children.every(c => c.pusWithFigure === c.totalPus)
  const voters = children.reduce((a, c) => a + (c.voters ?? 0), 0)
  return complete && voters > 0 ? 'registered_voters' : 'pu_count'
}

export type SetTargetOutcome
  = | { kind: 'ok', result: SetTargetResult }
    | { kind: 'forbidden' | 'not_found' | 'invalid' }

export async function setTarget(db: Db, caller: Caller, code: string, target: number): Promise<SetTargetOutcome> {
  if (!Number.isInteger(target) || target < 0 || target > MAX_TARGET) return { kind: 'invalid' }
  if (!canSetTarget(caller, code)) return { kind: 'forbidden' }

  const outcome = await db.transaction(async (tx) => {
    const [unit] = await tx.select({ code: units.code }).from(units).where(and(eq(units.code, code), eq(units.active, true)))
    if (!unit) return null
    const [before] = await tx.select({ target: unitTargets.target }).from(unitTargets).where(eq(unitTargets.unitCode, code)).for('update')
    await tx.insert(unitTargets).values({ unitCode: code, target, setBy: caller.id })
      .onConflictDoUpdate({ target: unitTargets.unitCode, set: { target, setBy: caller.id, setAt: sql`now()` } })
    return { previous: before?.target ?? null }
  })
  if (!outcome) return { kind: 'not_found' }

  await recordAudit(db, { id: caller.id, role: caller.role, ip: null }, {
    action: 'target.set',
    targetType: 'unit',
    targetId: code,
    scopeCode: code,
    meta: { from: outcome.previous, to: target },
  })
  return { kind: 'ok', result: { code, target, previous: outcome.previous } }
}

export type DistributeOutcome
  = | { kind: 'ok', result: DistributeResult }
    | { kind: 'forbidden' | 'not_found' | 'no_target' | 'no_children' }

/** Split the caller's own target across the active units below it; `preview` computes without saving. */
export async function distributeTarget(db: Db, caller: Caller, code: string, preview: boolean): Promise<DistributeOutcome> {
  if (!canDistribute(caller, code)) return { kind: 'forbidden' }
  const [unit] = await db.select({ code: units.code }).from(units).where(and(eq(units.code, code), eq(units.active, true)))
  if (!unit) return { kind: 'not_found' }
  const target = (await targetsFor(db, [code])).get(code)
  if (target === undefined) return { kind: 'no_target' }

  const kids = await db.select({ code: units.code, name: units.name }).from(units)
    .where(and(eq(units.parentCode, code), eq(units.active, true))).orderBy(asc(units.code))
  if (!kids.length) return { kind: 'no_children' }

  const [rows, previous] = await Promise.all([rollup(db, code, CHILD_CODE_LENGTH[unitLevel(code)!]!), targetsFor(db, kids.map(k => k.code))])
  const byCode = new Map(rows.map(r => [r.code, r]))
  const figures = kids.map((k) => {
    const r = byCode.get(k.code)
    return { voters: r?.voters ?? null, pusWithFigure: r?.pus_with_figure ?? 0, totalPus: r?.total_pus ?? 0 }
  })
  const basis = chooseBasis(figures)
  const weights = figures.map(f => (basis === 'registered_voters' ? f.voters ?? 0 : f.totalPus))
  const split = splitProportional(target, weights)
  const children: TargetSplitRow[] = kids.map((k, i) => ({
    code: k.code,
    name: k.name,
    weight: weights[i]!,
    target: split[i]!,
    previous: previous.get(k.code) ?? null,
  }))

  if (!preview) {
    await db.insert(unitTargets).values(children.map(c => ({ unitCode: c.code, target: c.target, setBy: caller.id })))
      .onConflictDoUpdate({ target: unitTargets.unitCode, set: { target: sql`excluded.target`, setBy: caller.id, setAt: sql`now()` } })
    await recordAudit(db, { id: caller.id, role: caller.role, ip: null }, {
      action: 'target.distribute',
      targetType: 'unit',
      targetId: code,
      scopeCode: code,
      meta: { target, basis, children: children.length },
    })
  }
  return { kind: 'ok', result: { code, target, basis, children, saved: !preview } }
}
