import type { MessageKey, Translator } from "../lib/i18n.js";
import type { AcquisitionInclude } from "../lib/suggest/acquisition/kinds.js";
import type { AcquisitionSort } from "../lib/suggest/acquisition/sort.js";
import type { AcquisitionTarget, PlatPriceLookup } from "../lib/suggest/acquisition/types.js";
import type { TrackerState } from "../lib/world/dailies.js";
import type { DropRow } from "../../config/shared/dropTypes.js";
import type { SortDirection } from "./filters.js";
import type { ItemDbEntry, MasteryData, RawInventoryData } from "./inventory.js";
import type { RelicDatabase, RelicQuality } from "./relics.js";
import type { WorldState } from "./world.js";

/** Which section a suggestion lands in, and what the filter checkboxes narrow by. */
export type SuggestionCategory =
  | "daily"
  | "weekly"
  | "nightwave"
  | "vendor"
  | "relics"
  | "acquisition"
  | "mastery";

export const SUGGESTION_CATEGORIES: readonly SuggestionCategory[] = [
  "daily",
  "weekly",
  "nightwave",
  "vendor",
  "relics",
  "acquisition",
  "mastery",
];

/** The categories the Tasks section pools, in the order its boxes read. The
 *  `nightwave` category is not one: acts are not suggestions, and the shop
 *  cards that replace them are a slice of their own. */
export const TASK_KINDS = ["daily", "weekly", "vendor"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type SuggestionSectionId = "tasks" | "relics" | "acquisition" | "mastery";

export interface SuggestionSection {
  id: SuggestionSectionId;
  titleKey: MessageKey;
  /** Everything the section draws, ordered as one grid rather than grouped. */
  categories: readonly SuggestionCategory[];
}

/** Section order on screen, time-boxed first. A new domain is a new row. */
export const SUGGESTION_SECTIONS: readonly SuggestionSection[] = [
  { id: "tasks", titleKey: "nextUp.sectionTasks", categories: TASK_KINDS },
  { id: "relics", titleKey: "common.relics", categories: ["relics"] },
  { id: "acquisition", titleKey: "nextUp.sectionAcquisition", categories: ["acquisition"] },
  { id: "mastery", titleKey: "common.mastery", categories: ["mastery"] },
];

export const SUGGESTION_SECTION_IDS: readonly SuggestionSectionId[] = SUGGESTION_SECTIONS.map(
  (section) => section.id,
);

/** Worth ladder groups, best first. `unplaced` is where every resolved reward
 *  the ladder has no opinion about lands, at zero worth. */
export const LADDER_GROUPS = ["must", "want", "useful", "filler", "junk"] as const;
export type LadderGroup = (typeof LADDER_GROUPS)[number];

export const WORTH_GROUPS = [...LADDER_GROUPS, "unplaced"] as const;
export type WorthGroup = (typeof WORTH_GROUPS)[number];

/** The four-tier scale the tile and settings components still draw worth as. A
 *  projection of the ladder group, never a scale anything scores off. */
export type RewardWorth = "great" | "good" | "ok" | "low";
export type MissionOpinion = "good" | "bad";
export type ActivityPref = "never" | "low" | "normal";

export const RELIC_GOALS = ["platinum", "ducats"] as const;
export type RelicGoal = (typeof RELIC_GOALS)[number];

export const RELIC_ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem"] as const;
export type RelicEra = (typeof RELIC_ERAS)[number];

export const RELIC_SORTS = ["recommended", "platinum", "ducats"] as const;
export type RelicSort = (typeof RELIC_SORTS)[number];

export const MASTERY_KINDS = ["frame", "weapon", "companion", "forma"] as const;
export type MasteryKind = (typeof MASTERY_KINDS)[number];

/** What each section narrows and orders by, and the one goal that rates nothing
 *  and so has no place in the activity map. Every list here reads an empty
 *  selection as "all", so unticking the last box can never empty a section. */
export interface SuggestionOptions {
  relicGoal: RelicGoal;
  taskKinds: TaskKind[];
  relicEras: RelicEra[];
  /** Platinum and ducats each pick a goal as well as an order. */
  relicSort: RelicSort;
  relicSortDir: SortDirection;
  masteryKinds: MasteryKind[];
  acquisitionSort: AcquisitionSort;
  acquisitionSortDir: SortDirection;
  acquisitionKinds: AcquisitionInclude[];
}

export const SCORE_WEIGHT_KEYS = ["value", "urgency", "effort"] as const;
export type ScoreWeightKey = (typeof SCORE_WEIGHT_KEYS)[number];

/** How far each raw signal moves a suggestion up or down the order. */
export type ScoreWeights = Record<ScoreWeightKey, number>;

/** Reward and mission keys are normalized names; activity keys are tracker task
 *  ids, plus "nightwave" for the whole act group. */
export interface SuggestionPreferences {
  /** Where each reward sits on the worth ladder. The only worth input. */
  worth: Record<string, WorthGroup>;
  /** The same placements as the four-tier scale the components draw. Derived
   *  from `worth`; editing it does nothing. */
  rewards: Record<string, RewardWorth>;
  missionTypes: Record<string, MissionOpinion>;
  activities: Record<string, ActivityPref>;
  /** Tier letters the player has overruled, by normalized item name. */
  acquisitionTiers: Record<string, string>;
  /** Farm-effort words the player has overruled, by normalized item name. */
  acquisitionEffort: Record<string, string>;
  /** How many of a Nightwave staple to keep on hand, by normalized item name.
   *  Below the level is worth buying; at zero it is urgent. */
  nightwaveStock: Record<string, number>;
  options: SuggestionOptions;
  weights: ScoreWeights;
}

/** The always-available Cred offerings worth nagging about, and what the app
 *  keeps on hand by default. Nothing else in the shop has a knowable rotation. */
export const NIGHTWAVE_STAPLES = ["orokin catalyst", "orokin reactor", "nitain extract"] as const;

export const DEFAULT_NIGHTWAVE_STOCK = 5;

/** Enough to tick a tracked task off without leaving the tab. */
export interface TrackerCompletion {
  taskId: string;
  periodKey: string | null;
  count: number;
  target: number;
}

/** Raw provider signals, each 0..1; the scorer owns how they combine. */
export interface SuggestionSignals {
  /** Worth doing at all, before urgency. */
  value: number;
  /** Cost to the player; higher pushes a suggestion down. */
  effort: number;
  /** Closing window. Providers get this from `urgencyFromExpiry`. */
  urgency: number;
  /** How far this offer actually advances *this* player, 0..1. Zero drops the
   *  suggestion entirely rather than ordering it last. Absent reads as 1. */
  gain?: number | undefined;
}

/** What the suggestion pays, kept out of the why line so art can stand in for it. */
export interface SuggestionReward {
  /** English item name, for the itemDb join and the tile's tooltip. */
  name: string;
  uniqueName?: string | undefined;
  /**
   * Set where the reward is one of several kinds and which one is not knowable
   * in advance: every kind it can be, best chance first. `name` is then the
   * family's own plural label, which resolves no art and names no member.
   */
  oneOf?: SuggestionReward[] | undefined;
}

/** One thing a pool pays. A bare name is all a stall's stock line carries; a
 *  drop row also carries the chance its table gives it. */
export interface SuggestionPoolRow {
  /** Drop-table name, count prefix and all, for the art and inventory joins. */
  name: string;
  uniqueName?: string | undefined;
  /** Percent per run, best roll where several tables of the pool carry it. */
  chance?: number | undefined;
  /** Curated worth, where the ladder places the name. */
  worth?: RewardWorth | undefined;
}

/** What a choice still owes the player: everything, a subsume, or nothing. */
export type ChoiceState = "wanted" | "subsume" | "done";

/** One place a choice can be farmed, straight out of the shipped table. */
export interface ChoiceSource {
  kind: string;
  where: string;
}

/** One pickable thing on a card: a strip on the art band, a row in the modal. */
export interface SuggestionChoice {
  name: string;
  imageUrl: string;
  /** Which detail rows the modal draws, and whether a subsume is even possible. */
  kind: "frame" | "adapter";
  state: ChoiceState;
  /** Tier letter, where the choices are rated against each other. */
  tier?: string | undefined;
  /** Unresearched placeholder for most frames; surfaced as it stands. */
  effort?: string | undefined;
  sources?: ChoiceSource[] | undefined;
  /** How the weapon's Incarnon form evolves. */
  upgradePath?: string | undefined;
}

/** One run of the why line, where parts of it read differently to the player. */
export interface WhySegment {
  text: string;
  tone?: "good" | "bad" | undefined;
}

/** One side of a pick the player makes on a given day. */
export interface SuggestionOption {
  name: string;
  uniqueName?: string | undefined;
  /** What to draw, where the full name is longer than it needs to read. The
   *  ladder, the art join and the ownership read all key off `name`. */
  displayName?: string | undefined;
  /** Curated worth, where the tables rate the item. */
  worth?: RewardWorth | undefined;
}

/** A day that offers a pick, with everything it offers. */
export interface SuggestionOptionGroup {
  day: number;
  options: SuggestionOption[];
}

/** What the card face has no room for; only the details view reads it. */
export interface SuggestionDetails {
  /** Everything the activity's pool pays, unfiltered. A drop pool supplies rows;
   *  a stall's stock is still a plain list of names. */
  pool?: readonly (SuggestionPoolRow | string)[] | undefined;
  /** The task's mission types, with the player's rating where they have one. */
  missions?: { name: string; opinion: MissionOpinion | null }[] | undefined;
  /** End of the window the suggestion is scored against. */
  expiry?: string | null | undefined;
  /** Days the player picks between, in the order they come round. */
  options?: SuggestionOptionGroup[] | undefined;
  /** Everything the acquisition resolver worked out about one piece of gear. */
  acquisition?: AcquisitionTarget | undefined;
  /** What a relic suggestion holds and what one crack of it pays. */
  relic?: RelicFacts | undefined;
}

/** The facts a relic card and its modal both draw, rather than a sentence. */
export interface RelicFacts {
  /** Copies held at the refinement this suggestion is about. */
  count: number;
  quality: RelicQuality;
  /** Node the live fissure is on. */
  node: string;
  /** Solo expected platinum of one crack; null when nothing prices the drops. */
  platinum: number | null;
  /** Solo expected ducats of one crack. */
  ducats: number | null;
}

export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  title: string;
  /** One line on why this is worth doing now, never naming the reward. */
  why: string;
  /** The same line split so the card can tone parts of it; the plain line stands
   *  in wherever this is absent. */
  whySegments?: WhySegment[] | undefined;
  reward?: SuggestionReward | undefined;
  /** Tier letter for the reward itself, drawn over its art as a choice's is. */
  tier?: string | undefined;
  /** What the week is offering to pick from; strips replace the reward art. */
  choices?: SuggestionChoice[] | undefined;
  /** The same line with the reward named, for when its art does not resolve. */
  whyWithReward?: string | undefined;
  signals: SuggestionSignals;
  score: number;
  /**
   * What the suggestion is a suggestion *about*. A dismissal is remembered
   * against this, so it lifts on its own once the world moves on.
   */
  fingerprint: string;
  /** Kept, but ordered below everything the player has not turned down. */
  deprioritized?: boolean | undefined;
  /** Where the provider put this in its own order. A section whose controls
   *  order it reads this instead of the score. */
  order?: number | undefined;
  progress?: { current: number; required: number } | undefined;
  complete?: TrackerCompletion | undefined;
  wiki?: string | undefined;
  details?: SuggestionDetails | undefined;
}

export interface SuggestionContext {
  world: WorldState | null;
  inventory: RawInventoryData | null;
  itemDb: Record<string, ItemDbEntry>;
  inventoryModifiedAt: number | null;
  mastery: MasteryData | null;
  relicDb: RelicDatabase | null;
  /** Median plat by market name, out of the cache the app already holds; a
   *  provider never fetches, so null simply leaves a route unpriced. */
  plat: PlatPriceLookup | null;
  tracker: TrackerState;
  prefs: SuggestionPreferences;
  /** Drop rows per tracker task id; a missing key means the pool is not loaded. */
  dropPools: Record<string, DropRow[]>;
  nowMs: number;
  t: Translator;
}

/** What a provider returns; scoring is the engine's job. */
export type SuggestionDraft = Omit<Suggestion, "score">;

export interface SuggestionProvider {
  id: string;
  collect: (ctx: SuggestionContext) => SuggestionDraft[];
}
