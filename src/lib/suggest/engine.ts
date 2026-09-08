import { isDismissed, suggestionKey, type DismissalState } from "./dismissals.js";
import { advances, gainOf } from "./gain.js";
import { bandFor, effectiveWorth, orderingScore, timeLeftMs, worthOf } from "./score.js";
import { unplacedCount } from "./unplaced.js";
import {
  SUGGESTION_CATEGORIES,
  type Suggestion,
  type SuggestionCategory,
  type SuggestionContext,
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
    bandFor(a) - bandFor(b) ||
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

export function collectSuggestions(
  providers: readonly SuggestionProvider[],
  ctx: SuggestionContext,
): Suggestion[] {
  return providers
    .flatMap((provider) => provider.collect(ctx))
    .map((draft) => ({ ...draft, score: orderingScore(draft, ctx.nowMs) }))
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
