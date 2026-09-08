import { noteUnplaced } from "./unplaced.js";
import {
  UNPLACED_WORTH,
  UNRESOLVED_WORTH,
  ladderWorth,
  normalizeName,
  rewardCount,
  taskRewardNames,
} from "./worthLadder.js";
import type { RewardWorth, SuggestionPreferences, WorthGroup } from "../../types/suggest.js";

export { normalizeName, rewardCount, UNPLACED_WORTH, UNRESOLVED_WORTH };

/** The four-tier scale the tile and settings components draw. Worth is the
 *  ladder's job; this only says which colour a name renders in. */
const LEGACY_WORTH: Record<WorthGroup, RewardWorth | null> = {
  must: "great",
  want: "good",
  useful: "ok",
  filler: "low",
  junk: "low",
  unplaced: null,
};

export function legacyWorth(group: WorthGroup): RewardWorth | null {
  return LEGACY_WORTH[group];
}

/** Which ladder group a reward sits in, or null when nothing places it. */
export function worthGroup(
  prefs: SuggestionPreferences,
  name: string | null | undefined,
): WorthGroup | null {
  if (!name) return null;
  return prefs.worth[normalizeName(name)] ?? null;
}

/** Null means unplaced, which the caller reads as no opinion - never as bad. */
export function rewardWorth(
  prefs: SuggestionPreferences,
  name: string | null | undefined,
): RewardWorth | null {
  const group = worthGroup(prefs, name);
  return group === null ? null : LEGACY_WORTH[group];
}

/** Where a reward lands on the ladder, counting included. Null for a name the
 *  ladder does not place; the name is logged so settings can show the gap. */
export function rewardValue(
  prefs: SuggestionPreferences,
  name: string | null | undefined,
  count?: number,
): number | null {
  if (!name) return null;
  const key = normalizeName(name);
  if (!key) return null;
  const group = prefs.worth[key];
  if (group === undefined || group === "unplaced") {
    noteUnplaced(key);
    return null;
  }
  return ladderWorth(group, key, count ?? rewardCount(name));
}

/** The best of everything a suggestion resolved. An unplaced name still counts
 *  as resolved, at zero, so a gap cannot lift anything. */
export function bestWorth(
  prefs: SuggestionPreferences,
  names: readonly (string | null | undefined)[],
): number | null {
  let best: number | null = null;
  for (const name of names) {
    if (!name) continue;
    const worth = rewardValue(prefs, name) ?? UNPLACED_WORTH;
    if (best === null || worth > best) best = worth;
  }
  return best;
}

/** What the curated table says a task pays, for tasks whose payout neither world
 *  state nor a drop pool ever names. */
export function taskWorth(prefs: SuggestionPreferences, taskId: string): number | null {
  const names = taskRewardNames(taskId);
  return names.length === 0 ? null : bestWorth(prefs, names);
}

export { taskRewardNames };
