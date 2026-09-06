import { writable, type Readable } from "svelte/store";

import { loadTracker, saveTracker, type TrackerState } from "../lib/world/dailies.js";

// The World tab and Next Up both tick these tasks off, so the state cannot live
// inside either component.
const store = writable<TrackerState>(loadTracker());

export const trackerState: Readable<TrackerState> = { subscribe: store.subscribe };

export function setTrackerState(next: TrackerState): void {
  saveTracker(next);
  store.set(next);
}
