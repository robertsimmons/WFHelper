import missionData from "../../data/suggest/missionTypes.json";
import rewardData from "../../data/suggest/rewardValues.json";
import { normalizeType } from "./missionTypes.js";
import { normalizeName } from "./rewards.js";
import type {
  ActivityPref,
  MissionOpinion,
  RewardTier,
  SuggestionPreferences,
} from "../../types/suggest.js";

/** An override carrying this drops the shipped rating instead of replacing it. */
export const UNRATED = "none";

/** Acts rotate, so the whole group answers to one activity setting. */
export const NIGHTWAVE_ACTIVITY = "nightwave";

/** Seasons come and go; the card art for the group is the player's pick. */
export const NIGHTWAVE_ART_IDS = ["amir", "nora"] as const;
export type NightwaveArt = (typeof NIGHTWAVE_ART_IDS)[number];
export const DEFAULT_NIGHTWAVE_ART: NightwaveArt = "amir";

export const REWARD_TIERS: readonly RewardTier[] = ["great", "good", "ok", "low"];
export const MISSION_OPINIONS: readonly MissionOpinion[] = ["good", "bad"];
export const ACTIVITY_PREFS: readonly ActivityPref[] = ["never", "low", "normal"];

export type RewardOverride = RewardTier | typeof UNRATED;
export type MissionOverride = MissionOpinion | typeof UNRATED;

export interface SuggestionOverrides {
  rewards: Record<string, RewardOverride>;
  missionTypes: Record<string, MissionOverride>;
  activities: Record<string, ActivityPref>;
}

/** The whole settings vocabulary for mission types, curated and unrated alike. */
export const MISSION_TYPE_NAMES: readonly string[] = [...missionData.all].sort((a, b) =>
  a.localeCompare(b),
);

function shippedRewards(): Record<string, RewardTier> {
  const rewards: Record<string, RewardTier> = {};
  for (const tier of REWARD_TIERS) {
    for (const name of rewardData.items[tier]) rewards[normalizeName(name)] = tier;
  }
  return rewards;
}

function shippedMissionTypes(): Record<string, MissionOpinion> {
  const missionTypes: Record<string, MissionOpinion> = {};
  for (const opinion of MISSION_OPINIONS) {
    for (const name of missionData[opinion]) missionTypes[normalizeType(name)] = opinion;
  }
  return missionTypes;
}

/** Normalized key to the spelling the curated tables ship, for display. */
export const REWARD_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  REWARD_TIERS.flatMap((tier) => rewardData.items[tier].map((name) => [normalizeName(name), name])),
);

export function defaultPreferences(): SuggestionPreferences {
  return { rewards: shippedRewards(), missionTypes: shippedMissionTypes(), activities: {} };
}

function mergeRatings<T extends string>(
  defaults: Readonly<Record<string, T>>,
  overrides: Readonly<Record<string, T | typeof UNRATED>>,
): Record<string, T> {
  const merged: Record<string, T> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === UNRATED) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

export function mergePreferences(
  defaults: SuggestionPreferences,
  overrides: SuggestionOverrides,
): SuggestionPreferences {
  return {
    rewards: mergeRatings(defaults.rewards, overrides.rewards),
    missionTypes: mergeRatings(defaults.missionTypes, overrides.missionTypes),
    activities: { ...defaults.activities, ...overrides.activities },
  };
}

/** Anything the stored JSON does not spell exactly right is dropped, not guessed. */
export function parseOverrides<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): Record<string, T> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, T> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
        result[key] = value as T;
      }
    }
    return result;
  } catch {
    return {};
  }
}
