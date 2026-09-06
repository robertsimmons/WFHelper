import { isDismissed, suggestionKey, type DismissalState } from "./dismissals.js";
import { scoreSignals } from "./score.js";
import {
  SUGGESTION_CATEGORIES,
  type Suggestion,
  type SuggestionCategory,
  type SuggestionContext,
  type SuggestionProvider,
} from "../../types/suggest.js";

export interface SuggestionFeed {
  /** Everything worth doing, best first. The view filters and pages it. */
  suggestions: Suggestion[];
  /** Live count per category, so a filter can show what it would reveal. */
  counts: Record<SuggestionCategory, number>;
  /** How many suggestions the user is currently choosing not to see. */
  hiddenCount: number;
  /** Every live dismissal key against its current fingerprint, for pruning. */
  fingerprints: Map<string, string>;
}

/** A band, not a penalty: a turned-down activity keeps its own ranking, below
 *  everything else, however good its score is. */
function band(suggestion: Suggestion): number {
  return suggestion.deprioritized ? 1 : 0;
}

export function collectSuggestions(
  providers: readonly SuggestionProvider[],
  ctx: SuggestionContext,
): Suggestion[] {
  return providers
    .flatMap((provider) => provider.collect(ctx))
    .map((draft) => ({ ...draft, score: scoreSignals(draft.signals) }))
    .sort((a, b) => band(a) - band(b) || b.score - a.score || a.id.localeCompare(b.id));
}

function emptyCounts(): Record<SuggestionCategory, number> {
  return { daily: 0, weekly: 0, nightwave: 0 };
}

export function buildFeed(
  suggestions: readonly Suggestion[],
  dismissals: DismissalState,
): SuggestionFeed {
  const fingerprints = new Map<string, string>();
  const visible: Suggestion[] = [];
  const counts = emptyCounts();
  let hiddenCount = 0;

  for (const suggestion of suggestions) {
    fingerprints.set(suggestionKey(suggestion.id), suggestion.fingerprint);
    if (isDismissed(dismissals, suggestionKey(suggestion.id), suggestion.fingerprint)) {
      hiddenCount += 1;
      continue;
    }
    visible.push(suggestion);
    counts[suggestion.category] += 1;
  }

  return { suggestions: visible, counts, hiddenCount, fingerprints };
}

/** Ranked order is the whole point, so filtering never reorders what survives. */
export function filterByCategory(
  suggestions: readonly Suggestion[],
  active: readonly SuggestionCategory[],
): Suggestion[] {
  if (active.length === 0 || active.length === SUGGESTION_CATEGORIES.length) {
    return [...suggestions];
  }
  return suggestions.filter((suggestion) => active.includes(suggestion.category));
}
