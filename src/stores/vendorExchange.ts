import { writable, type Readable } from "svelte/store";

import { readStoredJson, writeStorage } from "../lib/persistence.js";

/** Vendor to the rotation window whose offers Next Up was told are done. Only the
 *  latest window per vendor matters, so the store never grows past two keys. */
type ExchangeDone = Readonly<Record<string, string>>;

const STORAGE_KEY = "next-up-exchange-done";

function normalize(parsed: unknown): ExchangeDone {
  if (!parsed || typeof parsed !== "object") return {};
  const state: Record<string, string> = {};
  for (const [vendor, window] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof window === "string") state[vendor] = window;
  }
  return state;
}

const store = writable<ExchangeDone>(readStoredJson(STORAGE_KEY, normalize, () => ({})));

export const exchangeDone: Readable<ExchangeDone> = store;

export function markExchangeDone(vendor: string, window: string): void {
  store.update((state) => {
    const next = { ...state, [vendor]: window };
    writeStorage(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
}
