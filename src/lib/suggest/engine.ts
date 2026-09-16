import { isDismissed, suggestionKey, type DismissalState } from "./dismissals.js";
import { advances, gainOf } from "./gain.js";
import { bandFor, effectiveWorth, orderingScore, timeLeftMs, worthOf } from "./score.js";
import { unplacedCount } from "./unplaced.js";
import {
  SUGGESTION_CATEGORIES,
  type Suggestion,
  type SuggestionCategory,
  type SuggestionContext,
  type SuggestionDraft,
  type SuggestionProvider,
} from "../../types/suggest.js";

export interface SuggestionFeed {
  /** Everything worth doing, grouped by section and best first within each. */
  sections: Record<SuggestionCategory, Suggestion[]>;
  /** How many suggestions the user is currently choosing not to see. */
  hiddenCount: number;
  /** Resolved reward names the worth ladder has no place for, so settings can
   *  show the coverage gap rather than a middling score hiding it. */
  unplacedCount: number;
  /** Every live dismissal key against its current fingerprint, for pruning. */
  fingerprints: Map<string, string>;
}

/** A band, not a penalty: a turned-down activity keeps its own order, below
 *  everything else, however good its worth is. */
function turnedDown(suggestion: Suggestion): number {
  return suggestion.deprioritized ? 1 : 0;
}

/** Bands first, then worth, then gain, then time left. A section whose controls
 *  choose its order reads `order` instead. Effort orders nothing. */
export function compareSuggestions(a: Suggestion, b: Suggestion, nowMs: number): number {
  return (
    turnedDown(a) - turnedDown(b) ||
    bandFor(a, nowMs) - bandFor(b, nowMs) ||
    worthOf(b.signals) - worthOf(a.signals) ||
    effectiveWorth(b.signals) - effectiveWorth(a.signals) ||
    timeLeftMs(a, nowMs) - timeLeftMs(b, nowMs) ||
    a.id.localeCompare(b.id)
  );
}

/** Nothing this player stands to gain from is not a suggestion at all. */
function stillWanted(suggestion: Suggestion): boolean {
  return advances(gainOf(suggestion.signals));
}

/** A card's every `$derived` re-runs on a new `suggestion` object, so a draft a
 *  provider handed back unchanged has to score to the object it scored to last
 *  time. The score is `orderingScore` alone, so the clock is the only other
 *  input a hit has to match. */
const scored = new WeakMap<SuggestionDraft, { nowMs: number; suggestion: Suggestion }>();

function score(draft: SuggestionDraft, nowMs: number): Suggestion {
  const last = scored.get(draft);
  if (last && last.nowMs === nowMs) return last.suggestion;
  const suggestion = { ...draft, score: orderingScore(draft, nowMs) };
  scored.set(draft, { nowMs, suggestion });
  return suggestion;
}

export function collectSuggestions(
  providers: readonly SuggestionProvider[],
  ctx: SuggestionContext,
): Suggestion[] {
  return providers
    .flatMap((provider) => provider.collect(ctx))
    .map((draft) => score(draft, ctx.nowMs))
    .filter(stillWanted)
    .sort((a, b) => compareSuggestions(a, b, ctx.nowMs));
}

function emptySections(): Record<SuggestionCategory, Suggestion[]> {
  const sections = {} as Record<SuggestionCategory, Suggestion[]>;
  for (const category of SUGGESTION_CATEGORIES) sections[category] = [];
  return sections;
}

export function buildFeed(
  suggestions: readonly Suggestion[],
  dismissals: DismissalState,
): SuggestionFeed {
  const fingerprints = new Map<string, string>();
  const sections = emptySections();
  let hiddenCount = 0;

  for (const suggestion of suggestions) {
    fingerprints.set(suggestionKey(suggestion.id), suggestion.fingerprint);
    if (isDismissed(dismissals, suggestionKey(suggestion.id), suggestion.fingerprint)) {
      hiddenCount += 1;
      continue;
    }
    sections[suggestion.category].push(suggestion);
  }

  return { sections, hiddenCount, unplacedCount: unplacedCount(), fingerprints };
}
