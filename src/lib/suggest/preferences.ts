import missionData from "../../data/suggest/missionTypes.json";
import rewardData from "../../data/suggest/rewardValues.json";
import { normalizeType } from "./missionTypes.js";
import { normalizeName } from "./rewards.js";
import { RELIC_GOALS } from "../../types/suggest.js";
import type {
  ActivityPref,
  MissionOpinion,
  RelicGoal,
  RewardTier,
  SuggestionOptions,
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
  options: Partial<SuggestionOptions>;
}

export const DEFAULT_OPTIONS: SuggestionOptions = {
  relicGoal: "platinum",
  masteryForma: true,
  masteryOwnMode: true,
};

/** Synthetic activity ids these settings were stored under before they had a
 *  typed home; read once, on load, and then dropped. */
const LEGACY_FORMA_KEY = "mastery:forma";
const LEGACY_MODE_KEY = "mastery:mode";
const legacyGoalKey = (goal: RelicGoal): string => `relics:goal:${goal}`;

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
  return {
    rewards: shippedRewards(),
    missionTypes: shippedMissionTypes(),
    activities: {},
    options: { ...DEFAULT_OPTIONS },
  };
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
    options: { ...defaults.options, ...overrides.options },
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

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseOptions(raw: string | null): Partial<SuggestionOptions> {
  const parsed = parseJsonObject(raw);
  if (!parsed) return {};
  const options: Partial<SuggestionOptions> = {};
  const goal = parsed["relicGoal"];
  if (typeof goal === "string" && (RELIC_GOALS as readonly string[]).includes(goal)) {
    options.relicGoal = goal as RelicGoal;
  }
  if (typeof parsed["masteryForma"] === "boolean") options.masteryForma = parsed["masteryForma"];
  if (typeof parsed["masteryOwnMode"] === "boolean") {
    options.masteryOwnMode = parsed["masteryOwnMode"];
  }
  return options;
}

/** Lifts the settings that used to live as synthetic activity ids onto the typed
 *  shape, and clears the ids so nothing reads them twice. A value already stored
 *  under the new shape wins. */
export function migrateLegacyOptions(
  activities: Readonly<Record<string, ActivityPref>>,
  stored: Partial<SuggestionOptions>,
): { activities: Record<string, ActivityPref>; options: Partial<SuggestionOptions> } {
  const options: Partial<SuggestionOptions> = { ...stored };
  const legacyGoals = RELIC_GOALS.map(legacyGoalKey);

  if (options.masteryForma === undefined && activities[LEGACY_FORMA_KEY] !== undefined) {
    options.masteryForma = activities[LEGACY_FORMA_KEY] !== "never";
  }
  if (options.masteryOwnMode === undefined && activities[LEGACY_MODE_KEY] !== undefined) {
    options.masteryOwnMode = activities[LEGACY_MODE_KEY] !== "never";
  }
  if (options.relicGoal === undefined && legacyGoals.some((key) => key in activities)) {
    options.relicGoal =
      RELIC_GOALS.find((goal) => activities[legacyGoalKey(goal)] !== "never") ??
      DEFAULT_OPTIONS.relicGoal;
  }

  const rest: Record<string, ActivityPref> = { ...activities };
  for (const key of [LEGACY_FORMA_KEY, LEGACY_MODE_KEY, ...legacyGoals]) delete rest[key];
  return { activities: rest, options };
}
