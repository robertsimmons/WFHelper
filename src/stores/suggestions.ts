import { derived, get, writable, type Readable } from "svelte/store";

import { cachedPlatPrices } from "../lib/suggest/acquisition/platPrices.js";
import {
  dismiss,
  pruneDismissals,
  suggestionKey,
  type DismissalState,
} from "../lib/suggest/dismissals.js";
import { buildFeed, collectSuggestions, type SuggestionFeed } from "../lib/suggest/engine.js";
import { acquisitionProvider } from "../lib/suggest/providers/acquisition.js";
import { dailiesProvider } from "../lib/suggest/providers/dailies.js";
import { masteryProvider } from "../lib/suggest/providers/mastery.js";
import { relicsProvider } from "../lib/suggest/providers/relics.js";
import { vendorsProvider } from "../lib/suggest/providers/vendors.js";
import { tr } from "../lib/i18n.js";
import { readStorage, writeStorage } from "../lib/persistence.js";
import { clockStore } from "../lib/timers.js";
import { setTrackerCount } from "../lib/world/dailies.js";
import { setTrackerState, trackerState } from "./dailies.js";
import { inventoryData, inventoryModifiedAt, itemDb } from "./data.js";
import { dropPools } from "./dropPools.js";
import { masteryData } from "./mastery.js";
import { priceCacheRevision } from "./pricing.js";
import { relicDb } from "./relics.js";
import { suggestionPreferences } from "./suggestionPrefs.js";
import { worldData } from "./world.js";
import { SUGGESTION_CATEGORIES } from "../types/suggest.js";
import type { PlatPriceLookup } from "../lib/suggest/acquisition/types.js";
import type {
  SuggestionCategory,
  SuggestionProvider,
  TrackerCompletion,
} from "../types/suggest.js";

const STORAGE_KEY = "next-up-dismissals";
const FILTER_KEY = "next-up-filters";
const PROVIDERS: readonly SuggestionProvider[] = [
  dailiesProvider,
  vendorsProvider,
  relicsProvider,
  acquisitionProvider,
  masteryProvider,
];
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

// The lookup's identity is what tells the acquisition sweep its prices moved, so
// it is rebuilt only when the cache actually revises.
let platRevision = -1;
let platLookup: PlatPriceLookup = cachedPlatPrices();

function platPrices(revision: number): PlatPriceLookup {
  if (revision !== platRevision) {
    platRevision = revision;
    platLookup = cachedPlatPrices();
  }
  return platLookup;
}

export const suggestionFeed: Readable<SuggestionFeed> = derived(
  [
    worldData,
    inventoryData,
    inventoryModifiedAt,
    itemDb,
    masteryData,
    relicDb,
    priceCacheRevision,
    trackerState,
    dismissalStore,
    suggestionPreferences,
    dropPools,
    tr,
    clockStore(CLOCK_MS),
  ],
  ([
    $world,
    $inventory,
    $inventoryModifiedAt,
    $itemDb,
    $mastery,
    $relicDb,
    $priceRevision,
    $tracker,
    $dismissals,
    $prefs,
    $dropPools,
    $tr,
    $now,
  ]) => {
    const suggestions = collectSuggestions(PROVIDERS, {
      world: $world,
      inventory: $inventory,
      inventoryModifiedAt: $inventoryModifiedAt,
      itemDb: $itemDb,
      mastery: $mastery,
      relicDb: $relicDb,
      plat: platPrices($priceRevision),
      tracker: $tracker,
      prefs: $prefs,
      dropPools: $dropPools,
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

function loadFilters(): SuggestionCategory[] {
  const raw = readStorage(FILTER_KEY);
  if (!raw) return [...SUGGESTION_CATEGORIES];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...SUGGESTION_CATEGORIES];
    const picked = SUGGESTION_CATEGORIES.filter((category) => parsed.includes(category));
    // Every box unticked would leave nothing to suggest, so it reads as "all".
    return picked.length > 0 ? picked : [...SUGGESTION_CATEGORIES];
  } catch {
    return [...SUGGESTION_CATEGORIES];
  }
}

export const categoryFilter = writable<SuggestionCategory[]>(loadFilters());

export function toggleCategoryFilter(category: SuggestionCategory): void {
  const current = get(categoryFilter);
  const next = current.includes(category)
    ? current.filter((entry) => entry !== category)
    : SUGGESTION_CATEGORIES.filter((entry) => entry === category || current.includes(entry));
  const resolved = next.length > 0 ? next : [...SUGGESTION_CATEGORIES];
  categoryFilter.set(resolved);
  writeStorage(FILTER_KEY, JSON.stringify(resolved));
}
