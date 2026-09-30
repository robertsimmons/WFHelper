import { derived, type Writable } from "svelte/store";

import { persistedStringList } from "../lib/persistence.js";
import type { UpgradeKind } from "../lib/suggest/upgrades.js";

// Only a bound on a corrupt or hand-edited list, as acquisition's is.
const MAX_UPGRADE_PINS = 20;

function unique(list: readonly string[]): string[] {
  return [...new Set(list)];
}

function pinStore(kind: UpgradeKind): Writable<string[]> {
  const pins = persistedStringList(`${kind}.pinnedItems`, MAX_UPGRADE_PINS);
  const deduped = derived(pins, unique);
  return {
    subscribe: deduped.subscribe,
    set(value: string[]): void {
      pins.set(unique(value));
    },
    update(fn: (value: string[]) => string[]): void {
      pins.update((current) => unique(fn(unique(current))));
    },
  };
}

/** Names pinned to the top of the Next Up feed, oldest first, one list per kind. */
export const upgradePins: Record<UpgradeKind, Writable<string[]>> = {
  mods: pinStore("mods"),
  arcanes: pinStore("arcanes"),
};

export function toggleUpgradePin(kind: UpgradeKind, name: string): void {
  if (!name) return;
  upgradePins[kind].update((list) =>
    list.includes(name) ? list.filter((entry) => entry !== name) : [...list, name],
  );
}

export function unpinUpgrades(kind: UpgradeKind, names: readonly string[]): void {
  if (names.length === 0) return;
  const drop = new Set(names);
  upgradePins[kind].update((list) => list.filter((entry) => !drop.has(entry)));
}
