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
  /** Everything worth doing, grouped by section and best first within each. */
  sections: Record<SuggestionCategory, Suggestion[]>;
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
    .map((draft) => ({ ...draft, score: scoreSignals(draft.signals, ctx.prefs.weights) }))
    .sort((a, b) => band(a) - band(b) || b.score - a.score || a.id.localeCompare(b.id));
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

  return { sections, hiddenCount, fingerprints };
}
