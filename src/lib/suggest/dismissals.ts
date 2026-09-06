/** Dismissal key to the fingerprint it was made against; once that fingerprint
 *  no longer matches, the suggestion comes back. */
export type DismissalState = Record<string, string>;

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
