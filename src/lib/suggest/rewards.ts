import data from "../../data/suggest/rewardValues.json";
import type { RewardTier, SuggestionPreferences } from "../../types/suggest.js";

const TIER_VALUE: Record<RewardTier, number> = { great: 0.95, good: 0.7, ok: 0.4, low: 0.1 };

/** One pile, many spellings: rewards arrive counted ("3x Forma", "50,000 Kuva",
 *  "10k Kuva") and as either the blueprint or the built item. */
const COUNT_PREFIX = /^\d[\d,]*\s*[xk]?\s+/;
const BLUEPRINT_SUFFIX = /\s+blueprint$/;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(COUNT_PREFIX, "")
    .replace(BLUEPRINT_SUFFIX, "")
    .trim();
}

function buildTaskValues(): Map<string, number> {
  const index = new Map<string, number>();
  for (const [tier, ids] of Object.entries(data.tasks)) {
    const value = TIER_VALUE[tier as RewardTier];
    if (value === undefined) continue;
    for (const id of ids) index.set(id, value);
  }
  return index;
}

const TASK_VALUES = buildTaskValues();

/** Null means unrated, which the caller reads as no opinion - never as bad. */
export function rewardTier(
  prefs: SuggestionPreferences,
  name: string | null | undefined,
): RewardTier | null {
  if (!name) return null;
  return prefs.rewards[normalizeName(name)] ?? null;
}

export function rewardValue(
  prefs: SuggestionPreferences,
  name: string | null | undefined,
): number | null {
  const tier = rewardTier(prefs, name);
  return tier === null ? null : TIER_VALUE[tier];
}

/** Fallback for tasks whose reward is fixed but never named in world state. */
export function taskRewardValue(taskId: string): number | null {
  return TASK_VALUES.get(taskId) ?? null;
}
