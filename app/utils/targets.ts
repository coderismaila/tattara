// Targets page maths (task 6.4): how much of a lead's own target the units below already hold. Children's targets may
// add up to more or less than the parent's (ADR-048); the page shows the gap rather than refusing it.

export type Allocation
  = | { kind: 'no_target' }
    | { kind: 'under' | 'over', amount: number }
    | { kind: 'exact' }

/** `own` = the lead's target (null = none set); `children` = the targets below (null = none set, counts as 0). */
export function allocation(own: number | null, children: readonly (number | null)[]): Allocation {
  if (own === null) return { kind: 'no_target' }
  const sum = children.reduce<number>((a, b) => a + (b ?? 0), 0)
  if (sum === own) return { kind: 'exact' }
  return sum < own ? { kind: 'under', amount: own - sum } : { kind: 'over', amount: sum - own }
}
