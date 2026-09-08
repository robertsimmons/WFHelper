import missionData from "../../data/suggest/missionTypes.json";
import { EFFORT_WORDS } from "./acquisition/ratings.js";
import { TIERS } from "./acquisition/tiers.js";
import { ACQUISITION_INCLUDES } from "./acquisition/kinds.js";
import { ACQUISITION_SORTS, DEFAULT_ACQUISITION_SORT } from "./acquisition/sort.js";
import { normalizeType } from "./missionTypes.js";
import { legacyWorth } from "./rewards.js";
import { DEFAULT_WEIGHTS, WEIGHT_MAX } from "./score.js";
import {
  FOOT_POSITION,
  LADDER_DISPLAY_NAMES,
  TOP_POSITION,
  normalizeName,
  shippedPlacements,
} from "./worthLadder.js";
import {
  DEFAULT_NIGHTWAVE_STOCK,
  LADDER_GROUPS,
  MASTERY_KINDS,
  NIGHTWAVE_STAPLES,
  RELIC_ERAS,
  RELIC_GOALS,
  RELIC_SORTS,
  SCORE_WEIGHT_KEYS,
  TASK_KINDS,
  WORTH_GROUPS,
} from "../../types/suggest.js";
import type { AcquisitionSort } from "./acquisition/sort.js";
import type {
  ActivityPref,
  LadderGroup,
  MasteryKind,
  MissionOpinion,
  RelicGoal,
  RelicSort,
  RewardWorth,
  ScoreWeights,
  SuggestionOptions,
  SuggestionPreferences,
  WorthGroup,
} from "../../types/suggest.js";

/** An override carrying this drops the shipped rating instead of replacing it. */
export const UNRATED = "none";

/** Acts rotate, so the whole group answers to one activity setting. */
export const NIGHTWAVE_ACTIVITY = "nightwave";

/** Seasons come and go; the card art for the group is the player's pick. */
export const NIGHTWAVE_ART_IDS = ["amir", "nora"] as const;
export type NightwaveArt = (typeof NIGHTWAVE_ART_IDS)[number];
export const DEFAULT_NIGHTWAVE_ART: NightwaveArt = "amir";

/** What the player may overrule a shipped acquisition rating with. */
export const ACQUISITION_TIERS: readonly string[] = TIERS;
export const ACQUISITION_EFFORTS: readonly string[] = EFFORT_WORDS;

export { nameKey as acquisitionKey } from "./acquisition/curated.js";

/** The ladder groups the settings ladder draws, best first. */
export const WORTH_LADDER: readonly LadderGroup[] = LADDER_GROUPS;

/** The four-tier scale the ladder replaced, read out of storage and projected
 *  onto `rewards` for the tiles that still draw worth as a tier. */
export const REWARD_WORTHS: readonly RewardWorth[] = ["great", "good", "ok", "low"];
export const MISSION_OPINIONS: readonly MissionOpinion[] = ["good", "bad"];
export const ACTIVITY_PREFS: readonly ActivityPref[] = ["never", "low", "normal"];

/** A stored override may still be spelled on the four-tier scale the ladder
 *  replaced; both spellings are read, and only the ladder group is stored. */
const LEGACY_GROUP: Record<RewardWorth, WorthGroup> = {
  great: "must",
  good: "want",
  ok: "useful",
  low: "junk",
};

export type WorthOverride = WorthGroup | RewardWorth | typeof UNRATED;
export type MissionOverride = MissionOpinion | typeof UNRATED;

/** Everything `parseOverrides` accepts out of storage for a reward row. */
export const WORTH_OVERRIDES: readonly WorthOverride[] = [
  ...WORTH_GROUPS,
  ...REWARD_WORTHS,
  UNRATED,
];

export function canonicalWorth(value: WorthOverride): WorthGroup | typeof UNRATED {
  if (value === UNRATED) return UNRATED;
  return (LEGACY_GROUP as Record<string, WorthGroup | undefined>)[value] ?? (value as WorthGroup);
}

export interface SuggestionOverrides {
  rewards: Record<string, WorthGroup | typeof UNRATED>;
  /** Where the player dragged an entry inside its group's band. Absent for
   *  every group the player has left in the order it ships in. */
  rewardOrder: Record<string, number>;
  missionTypes: Record<string, MissionOverride>;
  activities: Record<string, ActivityPref>;
  acquisitionTiers: Record<string, string>;
  acquisitionEffort: Record<string, string>;
  nightwaveStock: Record<string, number>;
  options: Partial<SuggestionOptions>;
  weights: Partial<ScoreWeights>;
}

/** The Cred shop rotation is never published, so only the always-available
 *  staples are ever suggested, and only below the level kept here. */
export function shippedNightwaveStock(): Record<string, number> {
  const stock: Record<string, number> = {};
  for (const name of NIGHTWAVE_STAPLES) stock[name] = DEFAULT_NIGHTWAVE_STOCK;
  return stock;
}

export const DEFAULT_OPTIONS: SuggestionOptions = {
  relicGoal: "platinum",
  taskKinds: [...TASK_KINDS],
  relicEras: [...RELIC_ERAS],
  relicSort: "recommended",
  relicSortDir: "asc",
  masteryKinds: [...MASTERY_KINDS],
  acquisitionSort: DEFAULT_ACQUISITION_SORT,
  acquisitionSortDir: "asc",
  acquisitionKinds: [...ACQUISITION_INCLUDES],
};

/** Synthetic activity ids these settings were stored under before they had a
 *  typed home; read once, on load, and then dropped. */
const LEGACY_FORMA_KEY = "mastery:forma";
const LEGACY_MODE_KEY = "mastery:mode";
/** The boolean the Forma entry in `masteryKinds` replaced. */
const LEGACY_FORMA_OPTION = "masteryForma";
const legacyGoalKey = (goal: RelicGoal): string => `relics:goal:${goal}`;

/** The whole settings vocabulary for mission types, curated and unrated alike. */
export const MISSION_TYPE_NAMES: readonly string[] = [...missionData.all].sort((a, b) =>
  a.localeCompare(b),
);

/** The four-tier view of a set of ladder placements, for the components that
 *  still draw worth as a tier. Nothing scores off it. */
function asTiers(worth: Readonly<Record<string, WorthGroup>>): Record<string, RewardWorth> {
  const rewards: Record<string, RewardWorth> = {};
  for (const [key, group] of Object.entries(worth)) {
    const tier = legacyWorth(group);
    if (tier) rewards[key] = tier;
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

/** Normalized key to the spelling the ladder ships, for display. */
export const REWARD_DISPLAY_NAMES: Readonly<Record<string, string>> = LADDER_DISPLAY_NAMES;

export function defaultPreferences(): SuggestionPreferences {
  const worth = shippedPlacements();
  return {
    worth,
    rewards: asTiers(worth),
    missionTypes: shippedMissionTypes(),
    activities: {},
    acquisitionTiers: {},
    acquisitionEffort: {},
    nightwaveStock: shippedNightwaveStock(),
    options: { ...DEFAULT_OPTIONS },
    weights: { ...DEFAULT_WEIGHTS },
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

/** The acquisition sweep keys its cache on the merged maps by identity, so a
 *  merge that changed nothing has to hand back the object it handed back last
 *  time; a fresh spread would re-walk every masterable item on every toggle. */
function perField<A, B, R>(merge: (a: A, b: B) => R): (a: A, b: B) => R {
  let last: { a: A; b: B; result: R } | null = null;
  return (a, b) => {
    if (last && last.a === a && last.b === b) return last.result;
    const result = merge(a, b);
    last = { a, b, result };
    return result;
  };
}

const mergeWorth = perField(mergeRatings<WorthGroup>);
const mergeMissions = perField(mergeRatings<MissionOpinion>);

/** The tier view is only ever read; it is rebuilt when the placements move and
 *  handed back by identity otherwise. */
let tierSource: Readonly<Record<string, WorthGroup>> | null = null;
let tierView: Record<string, RewardWorth> = {};

function tiersFor(worth: Readonly<Record<string, WorthGroup>>): Record<string, RewardWorth> {
  if (worth !== tierSource) {
    tierSource = worth;
    tierView = asTiers(worth);
  }
  return tierView;
}
const mergeActivities = perField(
  (defaults: Record<string, ActivityPref>, overrides: Record<string, ActivityPref>) => ({
    ...defaults,
    ...overrides,
  }),
);
const mergeTiers = perField(
  (defaults: Record<string, string>, overrides: Record<string, string>) => ({
    ...defaults,
    ...overrides,
  }),
);
const mergeEffort = perField(
  (defaults: Record<string, string>, overrides: Record<string, string>) => ({
    ...defaults,
    ...overrides,
  }),
);
const mergeStock = perField(
  (defaults: Record<string, number>, overrides: Record<string, number>) => ({
    ...defaults,
    ...overrides,
  }),
);
const mergeOptions = perField(
  (defaults: SuggestionOptions, overrides: Partial<SuggestionOptions>): SuggestionOptions => ({
    ...defaults,
    ...overrides,
  }),
);
const mergeWeights = perField(
  (defaults: ScoreWeights, overrides: Partial<ScoreWeights>): ScoreWeights => ({
    ...defaults,
    ...overrides,
  }),
);

export function mergePreferences(
  defaults: SuggestionPreferences,
  overrides: SuggestionOverrides,
): SuggestionPreferences {
  const worth = mergeWorth(defaults.worth, overrides.rewards);
  return {
    worth,
    rewards: tiersFor(worth),
    missionTypes: mergeMissions(defaults.missionTypes, overrides.missionTypes),
    activities: mergeActivities(defaults.activities, overrides.activities),
    acquisitionTiers: mergeTiers(defaults.acquisitionTiers, overrides.acquisitionTiers),
    acquisitionEffort: mergeEffort(defaults.acquisitionEffort, overrides.acquisitionEffort),
    nightwaveStock: mergeStock(defaults.nightwaveStock, overrides.nightwaveStock),
    options: mergeOptions(defaults.options, overrides.options),
    weights: mergeWeights(defaults.weights, overrides.weights),
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

/** Order comes from the shipped list, never from the stored array, so a
 *  hand-edited file cannot reorder what the boxes read. */
function parseList<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  return Array.isArray(value) ? allowed.filter((entry) => value.includes(entry)) : null;
}

export function parseOptions(raw: string | null): Partial<SuggestionOptions> {
  const parsed = parseJsonObject(raw);
  if (!parsed) return {};
  const options: Partial<SuggestionOptions> = {};
  const goal = parsed["relicGoal"];
  if (typeof goal === "string" && (RELIC_GOALS as readonly string[]).includes(goal)) {
    options.relicGoal = goal as RelicGoal;
  }
  const tasks = parseList(parsed["taskKinds"], TASK_KINDS);
  if (tasks) options.taskKinds = tasks;
  const eras = parseList(parsed["relicEras"], RELIC_ERAS);
  if (eras) options.relicEras = eras;
  const relicSort = parsed["relicSort"];
  if (typeof relicSort === "string" && (RELIC_SORTS as readonly string[]).includes(relicSort)) {
    options.relicSort = relicSort as RelicSort;
  }
  const relicDir = parsed["relicSortDir"];
  if (relicDir === "asc" || relicDir === "desc") options.relicSortDir = relicDir;
  const masteryKinds = parseList(parsed["masteryKinds"], MASTERY_KINDS);
  if (masteryKinds) options.masteryKinds = masteryKinds;
  else if (parsed[LEGACY_FORMA_OPTION] === false) options.masteryKinds = withoutForma();
  const sort = parsed["acquisitionSort"];
  if (typeof sort === "string" && (ACQUISITION_SORTS as readonly string[]).includes(sort)) {
    options.acquisitionSort = sort as AcquisitionSort;
  }
  const direction = parsed["acquisitionSortDir"];
  if (direction === "asc" || direction === "desc") options.acquisitionSortDir = direction;
  const kinds = parsed["acquisitionKinds"];
  if (Array.isArray(kinds)) {
    options.acquisitionKinds = ACQUISITION_INCLUDES.filter((kind) => kinds.includes(kind));
  }
  return options;
}

function withoutForma(): MasteryKind[] {
  return MASTERY_KINDS.filter((kind) => kind !== "forma");
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

  if (options.masteryKinds === undefined && activities[LEGACY_FORMA_KEY] === "never") {
    options.masteryKinds = withoutForma();
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

/** A position is a fraction of its group's band, so a hand-edited file is
 *  clamped back into that band rather than allowed to lift an entry into the
 *  group above. Keys renormalize on the way in, so one saved under a counted
 *  or blueprint spelling still finds its row. */
export function parseLadderOrder(raw: string | null): Record<string, number> {
  const parsed = parseJsonObject(raw);
  if (!parsed) return {};
  const positions: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const name = normalizeName(key);
    if (!name || typeof value !== "number" || !Number.isFinite(value)) continue;
    positions[name] = Math.min(FOOT_POSITION, Math.max(TOP_POSITION, value));
  }
  return positions;
}

/** A keep-on-hand level is a count of items, so a fraction, a negative or a
 *  non-number is dropped rather than rounded, and the staple falls back to what
 *  it ships at. Keys are renormalized on the way in the way a worth override is,
 *  and a key no longer staple is kept, so trimming the list loses no level. */
export function parseNightwaveStock(raw: string | null): Record<string, number> {
  const parsed = parseJsonObject(raw);
  if (!parsed) return {};
  const stock: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const name = normalizeName(key);
    if (!name || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) continue;
    stock[name] = value;
  }
  return stock;
}

/** A stored weight outside the slider's range is pulled back into it, so a
 *  hand-edited file cannot make one signal the only one that counts. */
export function parseWeights(raw: string | null): Partial<ScoreWeights> {
  const parsed = parseJsonObject(raw);
  if (!parsed) return {};
  const weights: Partial<ScoreWeights> = {};
  for (const key of SCORE_WEIGHT_KEYS) {
    const value = parsed[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      weights[key] = Math.min(WEIGHT_MAX, Math.max(0, value));
    }
  }
  return weights;
}
