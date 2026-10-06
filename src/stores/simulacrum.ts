import { derived, writable } from "svelte/store";

import { reportCodexScanProgress } from "../lib/codexScanProgress.js";
import { invoke } from "../lib/ipc.js";
import {
  loreFragmentScans,
  scannableSuggestions,
  type LoreScan,
  type MissingScannables,
  type ScannableCategory,
} from "../lib/suggest/scannables.js";
import { loadSimulacrumFeed } from "../lib/suggest/simulacrumLazy.js";
import { simulacrumSuggestions } from "../lib/suggest/simulacrumView.js";
import { inventoryData } from "./data.js";
import type { Suggestion } from "../types/suggest.js";

interface SimulacrumState {
  suggestions: Suggestion[];
  /** The section's other categories, one entry per missing codex entry. */
  scannablesOf: (lore: readonly LoreScan[]) => MissingScannables;
  factionOf: (type: string) => string | null;
  enemyImage: (image: string | null) => string | null;
}

const EMPTY: SimulacrumState = {
  suggestions: [],
  scannablesOf: () => ({ objects: [], somachords: [], fragments: [], frameFighter: [] }),
  factionOf: () => null,
  enemyImage: () => null,
};

export const simulacrum = writable<SimulacrumState>(EMPTY);

let loading = false;

/** Asks for fresh scans, which the service rate-limits and backs with its cache,
 *  so finished entries drop off. No account and no cache leave the section empty. */
export async function refreshSimulacrum(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const [mod, result] = await Promise.all([loadSimulacrumFeed(), invoke("getCodexScans", true)]);
    if ("error" in result) {
      simulacrum.set(EMPTY);
      return;
    }
    void reportCodexScanProgress(result.fetchedAt, result.scans);
    const feed = mod.simulacrumFeed(result.scans);
    simulacrum.set({
      suggestions: simulacrumSuggestions(feed.cards),
      scannablesOf: feed.scannables,
      factionOf: (type) => feed.factions.get(type) ?? null,
      enemyImage: mod.enemyImageUrl,
    });
  } catch {
    simulacrum.set(EMPTY);
  } finally {
    loading = false;
  }
}

/** Recomputed on every inventory read, since lore progress lives there. */
export const scannables = derived(
  [simulacrum, inventoryData],
  ([$simulacrum, $inventory]): Record<ScannableCategory, Suggestion[]> => {
    const missing = $simulacrum.scannablesOf(loreFragmentScans($inventory));
    return {
      objects: scannableSuggestions(missing.objects),
      somachords: scannableSuggestions(missing.somachords),
      fragments: scannableSuggestions(missing.fragments),
      frameFighter: scannableSuggestions(missing.frameFighter),
    };
  },
);
