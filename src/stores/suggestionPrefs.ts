import { derived, get, writable, type Readable } from "svelte/store";

import { normalizeType } from "../lib/suggest/missionTypes.js";
import {
  ACTIVITY_PREFS,
  DEFAULT_NIGHTWAVE_ART,
  MISSION_OPINIONS,
  NIGHTWAVE_ART_IDS,
  REWARD_TIERS,
  UNRATED,
  defaultPreferences,
  mergePreferences,
  migrateLegacyOptions,
  parseOptions,
  parseOverrides,
  parseWeights,
  type MissionOverride,
  type NightwaveArt,
  type RewardOverride,
  type SuggestionOverrides,
} from "../lib/suggest/preferences.js";
import { readStorage, writeStorage } from "../lib/persistence.js";
import { normalizeName } from "../lib/suggest/rewards.js";
import { SUGGESTION_CATEGORIES } from "../types/suggest.js";
import type {
  ActivityPref,
  ScoreWeightKey,
  SuggestionCategory,
  SuggestionOptions,
  SuggestionPreferences,
} from "../types/suggest.js";

const REWARD_KEY = "next-up-reward-tiers";
const MISSION_KEY = "next-up-mission-types";
const ACTIVITY_KEY = "next-up-activities";
const OPTIONS_KEY = "next-up-options";
const WEIGHTS_KEY = "next-up-weights";
const NIGHTWAVE_ART_KEY = "next-up-nightwave-art";
const COLLAPSED_KEY = "next-up-collapsed-sections";

const REWARD_VALUES: readonly RewardOverride[] = [...REWARD_TIERS, UNRATED];
const MISSION_VALUES: readonly MissionOverride[] = [...MISSION_OPINIONS, UNRATED];

const DEFAULTS = defaultPreferences();

function load(): SuggestionOverrides {
  const migrated = migrateLegacyOptions(
    parseOverrides(readStorage(ACTIVITY_KEY), ACTIVITY_PREFS),
    parseOptions(readStorage(OPTIONS_KEY)),
  );
  return {
    rewards: parseOverrides(readStorage(REWARD_KEY), REWARD_VALUES),
    missionTypes: parseOverrides(readStorage(MISSION_KEY), MISSION_VALUES),
    activities: migrated.activities,
    options: migrated.options,
    weights: parseWeights(readStorage(WEIGHTS_KEY)),
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
  writeStorage(OPTIONS_KEY, JSON.stringify(next.options));
  writeStorage(WEIGHTS_KEY, JSON.stringify(next.weights));
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

export function setSuggestionOption<K extends keyof SuggestionOptions>(
  key: K,
  value: SuggestionOptions[K],
): void {
  const current = get(overrides);
  commit({ ...current, options: { ...current.options, [key]: value } });
}

export function setScoreWeight(key: ScoreWeightKey, value: number): void {
  const current = get(overrides);
  commit({ ...current, weights: { ...current.weights, [key]: value } });
}

export function resetScoreWeights(): void {
  commit({ ...get(overrides), weights: {} });
}

function loadNightwaveArt(): NightwaveArt {
  const raw = readStorage(NIGHTWAVE_ART_KEY);
  return NIGHTWAVE_ART_IDS.includes(raw as NightwaveArt)
    ? (raw as NightwaveArt)
    : DEFAULT_NIGHTWAVE_ART;
}

const art = writable<NightwaveArt>(loadNightwaveArt());

export const nightwaveArt: Readable<NightwaveArt> = { subscribe: art.subscribe };

export function setNightwaveArt(next: NightwaveArt): void {
  art.set(next);
  writeStorage(NIGHTWAVE_ART_KEY, next);
}

function loadCollapsed(): SuggestionCategory[] {
  const raw = readStorage(COLLAPSED_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return SUGGESTION_CATEGORIES.filter((category) => parsed.includes(category));
  } catch {
    return [];
  }
}

const collapsed = writable<SuggestionCategory[]>(loadCollapsed());

export const collapsedSections: Readable<SuggestionCategory[]> = {
  subscribe: collapsed.subscribe,
};

export function toggleSectionCollapsed(category: SuggestionCategory): void {
  const current = get(collapsed);
  const next = current.includes(category)
    ? current.filter((entry) => entry !== category)
    : [...current, category];
  collapsed.set(next);
  writeStorage(COLLAPSED_KEY, JSON.stringify(next));
}

export function resetSuggestionPreferences(): void {
  commit({ rewards: {}, missionTypes: {}, activities: {}, options: {}, weights: {} });
  setNightwaveArt(DEFAULT_NIGHTWAVE_ART);
}
