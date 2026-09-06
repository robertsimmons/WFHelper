import { derived, get, writable, type Readable } from "svelte/store";

import { normalizeType } from "../lib/suggest/missionTypes.js";
import {
  ACTIVITY_PREFS,
  MISSION_OPINIONS,
  REWARD_TIERS,
  UNRATED,
  defaultPreferences,
  mergePreferences,
  parseOverrides,
  type MissionOverride,
  type RewardOverride,
  type SuggestionOverrides,
} from "../lib/suggest/preferences.js";
import { readStorage, writeStorage } from "../lib/persistence.js";
import { normalizeName } from "../lib/suggest/rewards.js";
import type { ActivityPref, SuggestionPreferences } from "../types/suggest.js";

const REWARD_KEY = "next-up-reward-tiers";
const MISSION_KEY = "next-up-mission-types";
const ACTIVITY_KEY = "next-up-activities";

const REWARD_VALUES: readonly RewardOverride[] = [...REWARD_TIERS, UNRATED];
const MISSION_VALUES: readonly MissionOverride[] = [...MISSION_OPINIONS, UNRATED];

const DEFAULTS = defaultPreferences();

function load(): SuggestionOverrides {
  return {
    rewards: parseOverrides(readStorage(REWARD_KEY), REWARD_VALUES),
    missionTypes: parseOverrides(readStorage(MISSION_KEY), MISSION_VALUES),
    activities: parseOverrides(readStorage(ACTIVITY_KEY), ACTIVITY_PREFS),
  };
}

const overrides = writable<SuggestionOverrides>(load());

/** Which rows the user has moved off the shipped table, so the modal can offer
 *  a revert on those and only those. */
export const suggestionOverrides: Readable<SuggestionOverrides> = {
  subscribe: overrides.subscribe,
};

export const suggestionPreferences: Readable<SuggestionPreferences> = derived(
  overrides,
  ($overrides) => mergePreferences(DEFAULTS, $overrides),
);

function commit(next: SuggestionOverrides): void {
  overrides.set(next);
  writeStorage(REWARD_KEY, JSON.stringify(next.rewards));
  writeStorage(MISSION_KEY, JSON.stringify(next.missionTypes));
  writeStorage(ACTIVITY_KEY, JSON.stringify(next.activities));
}

function withEntry<T>(map: Record<string, T>, key: string, value: T | null): Record<string, T> {
  const next = { ...map };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

/** Null reverts the row to whatever the curated table ships for it. */
export function setRewardTier(name: string, tier: RewardOverride | null): void {
  const current = get(overrides);
  commit({ ...current, rewards: withEntry(current.rewards, normalizeName(name), tier) });
}

export function setMissionOpinion(name: string, opinion: MissionOverride | null): void {
  const current = get(overrides);
  commit({
    ...current,
    missionTypes: withEntry(current.missionTypes, normalizeType(name), opinion),
  });
}

/** Nothing ships an activity rating, so "normal" is simply the absence of one. */
export function setActivityPref(id: string, pref: ActivityPref): void {
  const current = get(overrides);
  commit({
    ...current,
    activities: withEntry(current.activities, id, pref === "normal" ? null : pref),
  });
}

export function resetSuggestionPreferences(): void {
  commit({ rewards: {}, missionTypes: {}, activities: {} });
}
