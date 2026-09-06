import type { SuggestionCategory } from "../../types/suggest.js";

/**
 * Dismissal key to the fingerprint it was made against. Storing the fingerprint
 * is what makes "not right now" temporary: once the world moves on the stored
 * one stops matching and the suggestion comes back on its own.
 */
export type DismissalState = Record<string, string>;

export function categoryKey(category: SuggestionCategory): string {
  return `cat:${category}`;
}

export function suggestionKey(id: string): string {
  return `sug:${id}`;
}

export function isDismissed(state: DismissalState, key: string, fingerprint: string): boolean {
  return state[key] === fingerprint;
}

export function dismiss(state: DismissalState, key: string, fingerprint: string): DismissalState {
  return { ...state, [key]: fingerprint };
}

/** Drops entries whose fingerprint no longer matches, so the store cannot grow forever. */
export function pruneDismissals(
  state: DismissalState,
  liveFingerprints: ReadonlyMap<string, string>,
): DismissalState {
  const pruned: DismissalState = {};
  for (const [key, fingerprint] of Object.entries(state)) {
    if (liveFingerprints.get(key) === fingerprint) pruned[key] = fingerprint;
  }
  return pruned;
}
