import { writable, type Readable } from "svelte/store";

import activityDrops from "../data/suggest/activityDrops.json";
import { invoke } from "../lib/ipc.js";
import type { DropRow } from "../../config/shared/dropTypes.js";

const PREFIXES: Record<string, readonly string[]> = activityDrops;

const pools = writable<Record<string, DropRow[]>>({});
const requested = new Map<string, Promise<void>>();

/** A missing key means the pool is not known yet, never an empty pool. */
export const dropPools: Readable<Record<string, DropRow[]>> = pools;

/** Drop data is a static local cache, so a pool is fetched once per session. */
function ensureDropPool(taskId: string): void {
  const prefixes = PREFIXES[taskId];
  if (!prefixes || requested.has(taskId)) return;
  const request = invoke("getDropPool", prefixes)
    .then((rows) => {
      pools.update((current) => ({ ...current, [taskId]: rows }));
    })
    .catch(() => {
      requested.delete(taskId);
    });
  requested.set(taskId, request);
}

export function ensureDropPools(): void {
  for (const taskId of Object.keys(PREFIXES)) ensureDropPool(taskId);
}
