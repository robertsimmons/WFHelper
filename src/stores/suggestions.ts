import { derived, get, writable, type Readable } from "svelte/store";

import {
  categoryKey,
  dismiss,
  pruneDismissals,
  suggestionKey,
  type DismissalState,
} from "../lib/suggest/dismissals.js";
import { buildFeed, collectSuggestions, type SuggestionFeed } from "../lib/suggest/engine.js";
import { dailiesProvider } from "../lib/suggest/providers/dailies.js";
import { tr } from "../lib/i18n.js";
import { readStorage, writeStorage } from "../lib/persistence.js";
import { clockStore } from "../lib/timers.js";
import { setTrackerCount } from "../lib/world/dailies.js";
import { setTrackerState, trackerState } from "./dailies.js";
import { inventoryData, inventoryModifiedAt } from "./data.js";
import { worldData } from "./world.js";
import type {
  SuggestionCategory,
  SuggestionProvider,
  TrackerCompletion,
} from "../types/suggest.js";

const STORAGE_KEY = "next-up-dismissals";
const PROVIDERS: readonly SuggestionProvider[] = [dailiesProvider];
/** Urgency is a slope, not a countdown; the cards run their own second timer. */
const CLOCK_MS = 30_000;

function loadDismissals(): DismissalState {
  const raw = readStorage(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const state: DismissalState = {};
    for (const [key, fingerprint] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof fingerprint === "string") state[key] = fingerprint;
    }
    return state;
  } catch {
    return {};
  }
}

const dismissalStore = writable<DismissalState>(loadDismissals());

// The prune on write needs the fingerprints the feed just computed, and the feed
// is the only place they exist.
let liveFingerprints: ReadonlyMap<string, string> = new Map();

export const suggestionFeed: Readable<SuggestionFeed> = derived(
  [
    worldData,
    inventoryData,
    inventoryModifiedAt,
    trackerState,
    dismissalStore,
    tr,
    clockStore(CLOCK_MS),
  ],
  ([$world, $inventory, $inventoryModifiedAt, $tracker, $dismissals, $tr, $now]) => {
    const suggestions = collectSuggestions(PROVIDERS, {
      world: $world,
      inventory: $inventory,
      inventoryModifiedAt: $inventoryModifiedAt,
      tracker: $tracker,
      nowMs: $now,
      t: $tr,
    });
    const feed = buildFeed(suggestions, $dismissals);
    liveFingerprints = feed.fingerprints;
    return feed;
  },
);

function commit(key: string, fingerprint: string): void {
  const next = dismiss(pruneDismissals(get(dismissalStore), liveFingerprints), key, fingerprint);
  dismissalStore.set(next);
  writeStorage(STORAGE_KEY, JSON.stringify(next));
}

export function dismissCategory(category: SuggestionCategory, fingerprint: string): void {
  commit(categoryKey(category), fingerprint);
}

export function dismissSuggestion(id: string, fingerprint: string): void {
  commit(suggestionKey(id), fingerprint);
}

/** Ticks a tracked task off from the feed, exactly as the World tab would. */
export function completeTask(completion: TrackerCompletion, count: number): void {
  setTrackerState(
    setTrackerCount(get(trackerState), completion.taskId, completion.periodKey, count),
  );
}

export function restoreAllSuggestions(): void {
  dismissalStore.set({});
  writeStorage(STORAGE_KEY, "{}");
}
