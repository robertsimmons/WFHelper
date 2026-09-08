import { derived, get, writable, type Readable } from "svelte/store";

import { normalizeType } from "../lib/suggest/missionTypes.js";
import {
  ACQUISITION_EFFORTS,
  ACQUISITION_TIERS,
  ACTIVITY_PREFS,
  DEFAULT_NIGHTWAVE_ART,
  MISSION_OPINIONS,
  NIGHTWAVE_ART_IDS,
  UNRATED,
  WORTH_OVERRIDES,
  acquisitionKey,
  canonicalWorth,
  defaultPreferences,
  mergePreferences,
  migrateLegacyOptions,
  parseLadderOrder,
  parseNightwaveStock,
  parseOptions,
  parseOverrides,
  parseWeights,
  type MissionOverride,
  type NightwaveArt,
  type WorthOverride,
  type SuggestionOverrides,
} from "../lib/suggest/preferences.js";
import { readStorage, writeStorage } from "../lib/persistence.js";
import { normalizeName } from "../lib/suggest/rewards.js";
import { reorderPositions, setLadderPositions } from "../lib/suggest/worthLadder.js";
import { SUGGESTION_SECTION_IDS } from "../types/suggest.js";
import type {
  ActivityPref,
  LadderGroup,
  SuggestionOptions,
  SuggestionPreferences,
  SuggestionSectionId,
  WorthGroup,
} from "../types/suggest.js";

const REWARD_KEY = "next-up-reward-tiers";
const ORDER_KEY = "next-up-reward-order";
const MISSION_KEY = "next-up-mission-types";
const ACTIVITY_KEY = "next-up-activities";
const ACQ_TIER_KEY = "next-up-acquisition-tiers";
const ACQ_EFFORT_KEY = "next-up-acquisition-difficulty";
const OPTIONS_KEY = "next-up-options";
const WEIGHTS_KEY = "next-up-weights";
const NIGHTWAVE_ART_KEY = "next-up-nightwave-art";
const NIGHTWAVE_STOCK_KEY = "next-up-nightwave-stock";
const COLLAPSED_KEY = "next-up-collapsed-sections";

const MISSION_VALUES: readonly MissionOverride[] = [...MISSION_OPINIONS, UNRATED];

const DEFAULTS = defaultPreferences();

/** Overrides stored on the four-tier scale the worth ladder replaced are read
 *  as the group they became, so a player's own placements survive the change. */
function loadWorth(): Record<string, WorthGroup | typeof UNRATED> {
  const stored = parseOverrides(readStorage(REWARD_KEY), WORTH_OVERRIDES);
  const migrated: Record<string, WorthGroup | typeof UNRATED> = {};
  for (const [key, value] of Object.entries(stored)) migrated[key] = canonicalWorth(value);
  return migrated;
}

function load(): SuggestionOverrides {
  const migrated = migrateLegacyOptions(
    parseOverrides(readStorage(ACTIVITY_KEY), ACTIVITY_PREFS),
    parseOptions(readStorage(OPTIONS_KEY)),
  );
  return {
    rewards: loadWorth(),
    rewardOrder: parseLadderOrder(readStorage(ORDER_KEY)),
    missionTypes: parseOverrides(readStorage(MISSION_KEY), MISSION_VALUES),
    activities: migrated.activities,
    acquisitionTiers: parseOverrides(readStorage(ACQ_TIER_KEY), ACQUISITION_TIERS),
    acquisitionEffort: parseOverrides(readStorage(ACQ_EFFORT_KEY), ACQUISITION_EFFORTS),
    nightwaveStock: parseNightwaveStock(readStorage(NIGHTWAVE_STOCK_KEY)),
    options: migrated.options,
    weights: parseWeights(readStorage(WEIGHTS_KEY)),
  };
}

const overrides = writable<SuggestionOverrides>(load());

setLadderPositions(get(overrides).rewardOrder);

/** Which rows the user has moved off the shipped table, so the modal can offer
 *  a revert on those and only those. */
export const suggestionOverrides: Readable<SuggestionOverrides> = {
  subscribe: overrides.subscribe,
};

export const suggestionPreferences: Readable<SuggestionPreferences> = derived(
  overrides,
  ($overrides) => mergePreferences(DEFAULTS, $overrides),
);

/** Positions reach the scorer through the ladder module rather than through
 *  `SuggestionPreferences`, so they are published before the store fires. */
function commit(next: SuggestionOverrides): void {
  setLadderPositions(next.rewardOrder);
  overrides.set(next);
  writeStorage(REWARD_KEY, JSON.stringify(next.rewards));
  writeStorage(ORDER_KEY, JSON.stringify(next.rewardOrder));
  writeStorage(MISSION_KEY, JSON.stringify(next.missionTypes));
  writeStorage(ACTIVITY_KEY, JSON.stringify(next.activities));
  writeStorage(ACQ_TIER_KEY, JSON.stringify(next.acquisitionTiers));
  writeStorage(ACQ_EFFORT_KEY, JSON.stringify(next.acquisitionEffort));
  writeStorage(NIGHTWAVE_STOCK_KEY, JSON.stringify(next.nightwaveStock));
  writeStorage(OPTIONS_KEY, JSON.stringify(next.options));
}

function withEntry<T>(map: Record<string, T>, key: string, value: T | null): Record<string, T> {
  const next = { ...map };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

/** Null reverts the row to whatever the shipped ladder places it at. A group
 *  change drops any position the entry was dragged to, so it lands where the
 *  new group would have put it rather than at the height it left. */
export function setRewardWorth(name: string, worth: WorthOverride | null): void {
  const current = get(overrides);
  const key = normalizeName(name);
  const placed = worth === null ? null : canonicalWorth(worth);
  commit({
    ...current,
    rewards: withEntry(current.rewards, key, placed),
    rewardOrder: withEntry(current.rewardOrder, key, null),
  });
}

/** Drops `key` at `index` of `group`, whose entries `ordered` names best first.
 *  The whole group is respaced, so the order the player chose is spelled out
 *  and an entry never left in a group keeps the position it ships at. */
export function moveRewardEntry(
  group: LadderGroup,
  ordered: readonly string[],
  key: string,
  index: number,
): void {
  const current = get(overrides);
  const name = normalizeName(key);
  if (!name) return;
  const placed = mergePreferences(DEFAULTS, current).worth[name];
  commit({
    ...current,
    rewards: placed === group ? current.rewards : withEntry(current.rewards, name, group),
    rewardOrder: {
      ...current.rewardOrder,
      ...reorderPositions(ordered.map(normalizeName), name, index),
    },
  });
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

/** Null drops the override, so the item goes back to the shipped rating. */
export function setAcquisitionTier(name: string, tier: string | null): void {
  const current = get(overrides);
  commit({
    ...current,
    acquisitionTiers: withEntry(current.acquisitionTiers, acquisitionKey(name), tier),
  });
}

export function setAcquisitionEffort(name: string, difficulty: string | null): void {
  const current = get(overrides);
  commit({
    ...current,
    acquisitionEffort: withEntry(current.acquisitionEffort, acquisitionKey(name), difficulty),
  });
}

/** Null, or anything a number input can hand back that is not a count, reverts
 *  the staple to the level it ships at. */
export function setNightwaveStock(name: string, level: number | null): void {
  const current = get(overrides);
  const key = normalizeName(name);
  if (!key) return;
  const kept = level === null || !Number.isFinite(level) ? null : Math.max(0, Math.round(level));
  commit({ ...current, nightwaveStock: withEntry(current.nightwaveStock, key, kept) });
}

export function setSuggestionOption<K extends keyof SuggestionOptions>(
  key: K,
  value: SuggestionOptions[K],
): void {
  const current = get(overrides);
  commit({ ...current, options: { ...current.options, [key]: value } });
}

/** Every list option the section headers tick boxes for. */
type ListOption = {
  [K in keyof SuggestionOptions]: SuggestionOptions[K] extends string[] ? K : never;
}[keyof SuggestionOptions];

/** Unticking the last box reads as "all", so a header can never empty its own
 *  section, and order comes from the shipped list rather than the click order. */
export function toggleSuggestionList<K extends ListOption>(
  key: K,
  all: readonly SuggestionOptions[K][number][],
  value: SuggestionOptions[K][number],
): void {
  const current = mergePreferences(DEFAULTS, get(overrides)).options[key] as readonly string[];
  const next = all.filter((entry) =>
    entry === value ? !current.includes(entry) : current.includes(entry),
  );
  setSuggestionOption(key, (next.length > 0 ? next : [...all]) as SuggestionOptions[K]);
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

function loadCollapsed(): SuggestionSectionId[] {
  const raw = readStorage(COLLAPSED_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return SUGGESTION_SECTION_IDS.filter((id) => parsed.includes(id));
  } catch {
    return [];
  }
}

const collapsed = writable<SuggestionSectionId[]>(loadCollapsed());

export const collapsedSections: Readable<SuggestionSectionId[]> = {
  subscribe: collapsed.subscribe,
};

export function toggleSectionCollapsed(id: SuggestionSectionId): void {
  const current = get(collapsed);
  const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
  collapsed.set(next);
  writeStorage(COLLAPSED_KEY, JSON.stringify(next));
}

export function resetSuggestionPreferences(): void {
  commit({
    rewards: {},
    rewardOrder: {},
    missionTypes: {},
    activities: {},
    acquisitionTiers: {},
    acquisitionEffort: {},
    nightwaveStock: {},
    options: {},
    weights: {},
  });
  setNightwaveArt(DEFAULT_NIGHTWAVE_ART);
}
