import type { MessageKey, Translator } from "../lib/i18n.js";
import type { TrackerState } from "../lib/world/dailies.js";
import type { DropRow } from "../../config/shared/dropTypes.js";
import type { ItemDbEntry, MasteryData, RawInventoryData } from "./inventory.js";
import type { RelicDatabase } from "./relics.js";
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

export interface SuggestionSection {
  category: SuggestionCategory;
  titleKey: MessageKey;
}

/** Section order on screen, time-boxed first. A new domain is a new row. */
export const SUGGESTION_SECTIONS: readonly SuggestionSection[] = [
  { category: "daily", titleKey: "dailies.groupDaily" },
  { category: "weekly", titleKey: "dailies.groupWeekly" },
  { category: "nightwave", titleKey: "dailies.groupNightwave" },
  { category: "vendor", titleKey: "nextUp.sectionVendor" },
  { category: "relics", titleKey: "nextUp.sectionRelics" },
  { category: "acquisition", titleKey: "nextUp.sectionAcquisition" },
  { category: "mastery", titleKey: "nextUp.sectionMastery" },
];

export const SUGGESTION_CATEGORIES: readonly SuggestionCategory[] = SUGGESTION_SECTIONS.map(
  (section) => section.category,
);

export type RewardTier = "great" | "good" | "ok" | "low";
export type MissionOpinion = "good" | "bad";
export type ActivityPref = "never" | "low" | "normal";

export const RELIC_GOALS = ["platinum", "ducats"] as const;
export type RelicGoal = (typeof RELIC_GOALS)[number];

/** Settings a provider reads that rate nothing, so they have no place in the
 *  activity map: one pick and two filters. */
export interface SuggestionOptions {
  relicGoal: RelicGoal;
  /** Whether the mastery shortlist may offer gear that only ranks on Forma. */
  masteryForma: boolean;
  /** Whether it may offer gear that only levels in its own game mode. */
  masteryOwnMode: boolean;
}

/** Reward and mission keys are normalized names; activity keys are tracker task
 *  ids, plus "nightwave" for the whole act group. */
export interface SuggestionPreferences {
  rewards: Record<string, RewardTier>;
  missionTypes: Record<string, MissionOpinion>;
  activities: Record<string, ActivityPref>;
  options: SuggestionOptions;
}

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
}

/** What the suggestion pays, kept out of the why line so art can stand in for it. */
export interface SuggestionReward {
  /** English item name, for the itemDb join and the tile's tooltip. */
  name: string;
  uniqueName?: string | undefined;
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
  /** Letter grade, where the choices are rated against each other. */
  grade?: string | undefined;
  /** Unresearched placeholder for most frames; surfaced as it stands. */
  difficulty?: string | undefined;
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
  /** Curated tier, where the tables rate the item. */
  tier?: RewardTier | undefined;
}

/** A day that offers a pick, with everything it offers. */
export interface SuggestionOptionGroup {
  day: number;
  options: SuggestionOption[];
}

/** What the card face has no room for; only the details view reads it. */
export interface SuggestionDetails {
  /** Reward families the activity's drop pool pays, by name. */
  pool?: string[] | undefined;
  /** The task's mission types, with the player's rating where they have one. */
  missions?: { name: string; opinion: MissionOpinion | null }[] | undefined;
  /** End of the window the suggestion is scored against. */
  expiry?: string | null | undefined;
  /** Days the player picks between, in the order they come round. */
  options?: SuggestionOptionGroup[] | undefined;
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
  /** Kept, but ranked below everything the player has not turned down. */
  deprioritized?: boolean | undefined;
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
