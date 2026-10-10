import { activeWindow } from "../format.js";
import { relicGroupForDisplayName, relicGroupForUniqueName } from "../relic/relicInventory.js";
import type { RelicDatabase, RelicGroup } from "../../types/relics.js";
import type { VaultTrader, VaultTraderInventoryItem } from "../../types/world.js";

const PROJECTION = "/Projections/";

export interface TraderRelic {
  group: RelicGroup;
  offer: VaultTraderInventoryItem;
}

export interface TraderShelf {
  expiry: string | null;
  relics: TraderRelic[];
}

/** The relics a trader (Varzia or Baro) has on the shelf now, one per relic;
 *  null while the trader is away. */
export function traderRelics(
  trader: VaultTrader | null | undefined,
  db: RelicDatabase,
  nowMs: number,
): TraderShelf | null {
  if (!trader || !activeWindow(trader.activation, trader.expiry, nowMs)) return null;
  const seen = new Set<string>();
  const relics: TraderRelic[] = [];
  for (const offer of trader.inventory ?? []) {
    const uniqueName = offer.uniqueName ?? "";
    if (!uniqueName.includes(PROJECTION)) continue;
    const group =
      relicGroupForUniqueName(db, uniqueName) ??
      (offer.item ? relicGroupForDisplayName(db, offer.item) : null);
    if (!group || seen.has(group.key)) continue;
    seen.add(group.key);
    relics.push({ group, offer });
  }
  return { expiry: trader.expiry ?? null, relics };
}
