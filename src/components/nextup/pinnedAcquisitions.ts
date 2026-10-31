import type { Translator } from "../../lib/i18n.js";
import type { ResolvedPlan } from "../../lib/suggest/acquisition/plan/index.js";
import type { Suggestion } from "../../types/suggest.js";
import { planSteps, stepProgress } from "./plan/planSteps.js";

/** Where the player stands in the plan's numbered steps. */
interface StepAt {
  step: number;
  total: number;
}

export interface PinnedEntry {
  uniqueName: string;
  suggestion: Suggestion;
  /** Null until a plan has been resolved for the item. */
  steps: StepAt | null;
}

// Only the count is read, so a step's title never has to be translated here.
const KEYS: Translator = (key) => key;

/** The step the card names: the first one the plan's steps still have open. */
export function nextStep(plan: ResolvedPlan, buildable: boolean, t: Translator = KEYS): StepAt {
  return stepProgress(planSteps(plan, { t, buildable }));
}

/** What a pin is stored as, which is what the resolver named the item. */
export function acquisitionKey(suggestion: Suggestion): string | null {
  return suggestion.reward?.uniqueName ?? null;
}

/** Pinned items in pin order. The provider carries every pin the sweep still
 *  has open, so one it does not carry is finished and draws nothing. */
export function pinnedAcquisitions(
  pins: readonly string[],
  suggestions: readonly Suggestion[],
  plans: Readonly<Record<string, ResolvedPlan>> = {},
  t: Translator = KEYS,
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
    const buildable = suggestion.details?.acquisition?.parts.buildable === true;
    return [{ uniqueName, suggestion, steps: plan ? nextStep(plan, buildable, t) : null }];
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
