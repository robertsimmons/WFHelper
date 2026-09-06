import { categoryKey, isDismissed, suggestionKey, type DismissalState } from "./dismissals.js";
import { scoreSignals } from "./score.js";
import type {
  Suggestion,
  SuggestionCategory,
  SuggestionContext,
  SuggestionProvider,
} from "../../types/suggest.js";

interface SuggestionGroup {
  category: SuggestionCategory;
  fingerprint: string;
  suggestions: Suggestion[];
}

export interface SuggestionFeed {
  groups: SuggestionGroup[];
  /** How many suggestions the user is currently choosing not to see. */
  hiddenCount: number;
  /** Every live dismissal key against its current fingerprint, for pruning. */
  fingerprints: Map<string, string>;
}

export function collectSuggestions(
  providers: readonly SuggestionProvider[],
  ctx: SuggestionContext,
): Suggestion[] {
  return providers
    .flatMap((provider) => provider.collect(ctx))
    .map((draft) => ({ ...draft, score: scoreSignals(draft.signals) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Members define the category, so a rotation changes it and lifts its dismissal. */
function groupFingerprint(suggestions: readonly Suggestion[]): string {
  return suggestions
    .map((suggestion) => suggestion.fingerprint)
    .sort()
    .join("|");
}

export function buildFeed(
  suggestions: readonly Suggestion[],
  dismissals: DismissalState,
): SuggestionFeed {
  const byCategory = new Map<SuggestionCategory, Suggestion[]>();
  for (const suggestion of suggestions) {
    const members = byCategory.get(suggestion.category);
    if (members) members.push(suggestion);
    else byCategory.set(suggestion.category, [suggestion]);
  }

  const fingerprints = new Map<string, string>();
  const groups: SuggestionGroup[] = [];
  let hiddenCount = 0;

  for (const [category, members] of byCategory) {
    const fingerprint = groupFingerprint(members);
    fingerprints.set(categoryKey(category), fingerprint);
    for (const member of members) fingerprints.set(suggestionKey(member.id), member.fingerprint);

    if (isDismissed(dismissals, categoryKey(category), fingerprint)) {
      hiddenCount += members.length;
      continue;
    }

    const visible = members.filter(
      (member) => !isDismissed(dismissals, suggestionKey(member.id), member.fingerprint),
    );
    hiddenCount += members.length - visible.length;
    if (visible.length > 0) groups.push({ category, fingerprint, suggestions: visible });
  }

  groups.sort((a, b) => (b.suggestions[0]?.score ?? 0) - (a.suggestions[0]?.score ?? 0));
  return { groups, hiddenCount, fingerprints };
}
