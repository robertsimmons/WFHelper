import type { MessageKey, Translator } from "../lib/i18n.js";
import type { TrackerState } from "../lib/world/dailies.js";
import type { RawInventoryData } from "./inventory.js";
import type { ViewName } from "./views.js";
import type { WorldState } from "./world.js";

/** Dismissal unit: hiding one takes every suggestion under it with it. */
export type SuggestionCategory = "daily" | "weekly" | "nightwave";

/** Enough to tick a tracked task off without leaving the tab. */
export interface TrackerCompletion {
  taskId: string;
  periodKey: string | null;
  count: number;
  target: number;
}

/** Quiet way out to the view that owns the task, for when the card is not enough. */
interface SuggestionLink {
  view: ViewName;
  labelKey: MessageKey;
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

export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  title: string;
  /** One line on why this is worth doing now. */
  why: string;
  signals: SuggestionSignals;
  score: number;
  /**
   * What the suggestion is a suggestion *about*. A dismissal is remembered
   * against this, so it lifts on its own once the world moves on.
   */
  fingerprint: string;
  expiry?: string | null | undefined;
  progress?: { current: number; required: number } | undefined;
  complete?: TrackerCompletion | undefined;
  link?: SuggestionLink | undefined;
  wiki?: string | undefined;
}

export interface SuggestionContext {
  world: WorldState | null;
  inventory: RawInventoryData | null;
  inventoryModifiedAt: number | null;
  tracker: TrackerState;
  nowMs: number;
  t: Translator;
}

/** What a provider returns; scoring is the engine's job. */
export type SuggestionDraft = Omit<Suggestion, "score">;

export interface SuggestionProvider {
  id: string;
  collect: (ctx: SuggestionContext) => SuggestionDraft[];
}
