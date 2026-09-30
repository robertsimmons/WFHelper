import {
  cardFor,
  type Holdings,
  type UpgradeCard,
  type UpgradeCatalog,
  type UpgradeKind,
} from "../../lib/suggest/upgrades.js";
import type { ItemDbEntry } from "../../types/inventory.js";
import type { Suggestion } from "../../types/suggest.js";

export interface PinnedUpgrade {
  kind: UpgradeKind;
  name: string;
  card: UpgradeCard;
}

/** What an upgrade pin is stored as, which is its name on the popularity list. */
export function upgradeKey(suggestion: Suggestion): string | null {
  return suggestion.details?.upgrade?.name ?? null;
}

/** Pinned names in pin order, built off the item database rather than the feed:
 *  the band only holds what the search and the page limit let through. An
 *  owned one is on its way out of the list and draws nothing. */
export function pinnedUpgrades(
  catalog: UpgradeCatalog,
  pins: readonly string[],
  itemDb: Record<string, ItemDbEntry>,
  holdings: Holdings,
): PinnedUpgrade[] {
  return pins
    .filter((name) => !catalog.owns(name, itemDb, holdings))
    .map((name) => ({ kind: catalog.kind, name, card: cardFor(catalog, name, itemDb, holdings) }));
}

export function withoutPinnedUpgrades(
  suggestions: readonly Suggestion[],
  pins: readonly string[],
): Suggestion[] {
  const pinned = new Set(pins);
  return suggestions.filter((suggestion) => {
    const key = upgradeKey(suggestion);
    return key === null || !pinned.has(key);
  });
}
