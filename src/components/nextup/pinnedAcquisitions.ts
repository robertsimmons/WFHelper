import type { Suggestion } from "../../types/suggest.js";

/** The part of a resolved plan a pinned card counts: every row of every group,
 *  whatever else the group carries. */
export interface PlanSteps {
  groups: readonly { rows: readonly { done?: boolean | undefined }[] }[];
}

export interface StepCount {
  done: number;
  total: number;
}

export interface PinnedEntry {
  uniqueName: string;
  suggestion: Suggestion;
  /** Null until a plan has been resolved for the item. */
  steps: StepCount | null;
}

export function stepCount(plan: PlanSteps): StepCount {
  let done = 0;
  let total = 0;
  for (const group of plan.groups) {
    for (const row of group.rows) {
      total += 1;
      if (row.done === true) done += 1;
    }
  }
  return { done, total };
}

/** The step the player is on, which is the last one once every row is ticked. */
export function nextStep(steps: StepCount): number {
  return Math.min(steps.done + 1, steps.total);
}

/** What a pin is stored as, which is what the resolver named the item. */
export function acquisitionKey(suggestion: Suggestion): string | null {
  return suggestion.reward?.uniqueName ?? null;
}

/** Pinned items in pin order. A pin the current sweep does not carry - filtered
 *  out by kind, or already finished - draws nothing rather than an empty card. */
export function pinnedAcquisitions(
  pins: readonly string[],
  suggestions: readonly Suggestion[],
  plans: Readonly<Record<string, PlanSteps>> = {},
): PinnedEntry[] {
  const byKey = new Map<string, Suggestion>();
  for (const suggestion of suggestions) {
    const key = acquisitionKey(suggestion);
    if (key !== null && !byKey.has(key)) byKey.set(key, suggestion);
  }
  return pins.flatMap((uniqueName) => {
    const suggestion = byKey.get(uniqueName);
    if (!suggestion) return [];
    const plan = plans[uniqueName];
    return [{ uniqueName, suggestion, steps: plan ? stepCount(plan) : null }];
  });
}

export function withoutPinned(
  suggestions: readonly Suggestion[],
  pins: readonly string[],
): Suggestion[] {
  const pinned = new Set(pins);
  return suggestions.filter((suggestion) => {
    const key = acquisitionKey(suggestion);
    return key === null || !pinned.has(key);
  });
}
