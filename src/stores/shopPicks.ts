import { writable, type Readable } from "svelte/store";

import { readStoredJson, writeStorage } from "../lib/persistence.js";

const KEY = "acquisition.shopPicks";

/** Per shop key, the unit ids flipped away from their default pick. Every plan
 *  buying from the shop shares them. */
type ShopPickTable = Record<string, string[]>;

function normalize(parsed: unknown): ShopPickTable {
  if (!parsed || typeof parsed !== "object") return {};
  const table: ShopPickTable = {};
  for (const [shop, ids] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(ids)) continue;
    table[shop] = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  }
  return table;
}

const store = writable<ShopPickTable>(readStoredJson(KEY, normalize, () => ({})));

export const shopPicks: Readable<ShopPickTable> = { subscribe: store.subscribe };

export function toggleShopPick(shop: string, unitId: string): void {
  store.update((table) => {
    const ids = table[shop] ?? [];
    const next = {
      ...table,
      [shop]: ids.includes(unitId) ? ids.filter((id) => id !== unitId) : [...ids, unitId],
    };
    writeStorage(KEY, JSON.stringify(next));
    return next;
  });
}
