import { writable, type Readable } from "svelte/store";

import { invoke } from "../lib/ipc.js";
import type { ItemTiers } from "../lib/suggest/acquisition/tiers.js";

let fresh: unknown = null;
let request: Promise<void> | null = null;

const revision = writable(0);

/** Bumps when a refreshed overframe table replaces the bundled one, so derived
 *  tier work can recompute. */
export const overframeRankingsRevision: Readable<number> = revision;

export function loadOverframeRankings(): Promise<void> {
  if (request) return request;
  try {
    request = invoke("getOverframeRankings")
      .then((rankings) => {
        if (!rankings) return;
        fresh = rankings;
        revision.update((n) => n + 1);
      })
      .catch(() => undefined);
  } catch {
    request = Promise.resolve();
  }
  return request;
}

/** Tiers from the freshest table available: the refreshed one once it lands,
 *  the bundled one until then. `build` is passed in so this never imports the
 *  loader it serves. */
export function preferFreshRankings(
  build: (source: unknown) => ItemTiers,
  bundled: unknown,
): ItemTiers {
  let source: unknown;
  let tiers: ItemTiers | null = null;
  return (name) => {
    void loadOverframeRankings();
    const next = fresh ?? bundled;
    if (!tiers || next !== source) {
      source = next;
      tiers = build(next);
    }
    return tiers(name);
  };
}
