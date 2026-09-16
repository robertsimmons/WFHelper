import { derived, type Writable } from "svelte/store";

import { persistedStringList } from "../lib/persistence.js";

// Only a bound on a corrupt or hand-edited list: the cap the player feels is
// SOFT_ACQUISITION_PINS, and going past it is allowed.
const MAX_ACQUISITION_PINS = 20;

/** Past this the strip stops reading as what the player is working on. Advisory:
 *  a pin over it is kept, and the strip says so in a line under the cards. */
export const SOFT_ACQUISITION_PINS = 3;

function unique(list: readonly string[]): string[] {
  return [...new Set(list)];
}

// A repeated uniqueName throws each_key_duplicate in the strip's keyed block.
// Dedupe on read so a plain start never writes localStorage, and on every write.
const pins = persistedStringList("acquisition.pinnedItems", MAX_ACQUISITION_PINS);
const dedupedPins = derived(pins, unique);

/** Acquisition uniqueNames pinned to the top of the Next Up feed, oldest first. */
export const acquisitionPins: Writable<string[]> = {
  subscribe: dedupedPins.subscribe,
  set(value: string[]): void {
    pins.set(unique(value));
  },
  update(fn: (value: string[]) => string[]): void {
    pins.update((current) => unique(fn(unique(current))));
  },
};

export function toggleAcquisitionPin(uniqueName: string): void {
  if (!uniqueName) return;
  acquisitionPins.update((list) =>
    list.includes(uniqueName)
      ? list.filter((entry) => entry !== uniqueName)
      : [...list, uniqueName],
  );
}

export function unpinAcquisitionItems(uniqueNames: readonly string[]): void {
  if (uniqueNames.length === 0) return;
  const drop = new Set(uniqueNames);
  acquisitionPins.update((list) => list.filter((entry) => !drop.has(entry)));
}
