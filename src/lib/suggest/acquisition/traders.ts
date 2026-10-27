import { activeWindow } from "../../format.js";
import { traderRelics } from "../traderRelics.js";
import { relicsPaying, TRADER_PLACES } from "./plan/prime.js";
import type { RelicDatabase } from "../../../types/relics.js";
import type { VaultTrader, WorldState } from "../../../types/world.js";
import type { AcquisitionPath, PartState, PathStep } from "./types.js";

type TraderId = "baro" | "varzia";

const BARO = /baro ki.teer/i;
const STORE_ITEMS = "/StoreItems/";

/** What one trader has on the shelf now: names and uniqueNames, and the relics. */
interface Shelf {
  names: Set<string>;
  relics: Set<string>;
}

/** A trader who is away has no shelf. */
export type TraderShelves = Record<TraderId, Shelf | null>;

/** "Sands of Inaros Blueprint" and "Sands of Inaros" are one offer. */
function nameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+blueprint$/, "")
    .trim();
}

/** The trader a step buys from; null for anywhere else. */
export function traderAt(where: string): TraderId | null {
  if (BARO.test(where)) return "baro";
  return TRADER_PLACES.some((place) => where.startsWith(place)) ? "varzia" : null;
}

function shelfOf(
  trader: VaultTrader | null | undefined,
  relicDb: RelicDatabase | null | undefined,
  now: number,
): Shelf | null {
  if (!trader || !activeWindow(trader.activation, trader.expiry, now)) return null;
  const names = new Set<string>();
  for (const offer of trader.inventory ?? []) {
    if (offer.item) names.add(nameKey(offer.item));
    if (offer.uniqueName) {
      names.add(offer.uniqueName.toLowerCase());
      names.add(offer.uniqueName.replace(STORE_ITEMS, "/").toLowerCase());
    }
  }
  const sold = relicDb ? traderRelics(trader, relicDb, now) : null;
  return { names, relics: new Set((sold?.relics ?? []).map((entry) => entry.group.name)) };
}

/** Null without a world read: unknown stock, which never walks. */
export function traderShelves(
  world: WorldState | null | undefined,
  relicDb: RelicDatabase | null | undefined,
  now: number,
): TraderShelves | null {
  if (!world) return null;
  return {
    baro: shelfOf(world.voidTrader, relicDb, now),
    varzia: shelfOf(world.vaultTrader, relicDb, now),
  };
}

/** Every relic group a trader sells right now, by name. */
export function soldRelics(shelves: TraderShelves | null): Set<string> {
  return new Set([...(shelves?.baro?.relics ?? []), ...(shelves?.varzia?.relics ?? [])]);
}

/** Changes only when a trader arrives, leaves or restocks. */
export function traderStockKey(world: WorldState | null | undefined, now: number): string {
  if (!world) return "?";
  return [world.voidTrader, world.vaultTrader]
    .map((trader) => {
      if (!trader || !activeWindow(trader.activation, trader.expiry, now)) return "-";
      const stock = (trader.inventory ?? []).map((offer) => offer.uniqueName ?? offer.item ?? "");
      return `${trader.activation}|${trader.expiry}|${stock.join(",")}`;
    })
    .join("#");
}

interface StockInputs {
  itemName: string;
  missing: readonly PartState[];
  relicDb: RelicDatabase | null | undefined;
}

function partSold(shelf: Shelf, name: string, input: StockInputs): boolean {
  if (shelf.names.has(nameKey(name))) return true;
  const part = input.missing.find((entry) => entry.name === name);
  if (part?.uniqueName && shelf.names.has(part.uniqueName.toLowerCase())) return true;
  if (!input.relicDb || shelf.relics.size === 0) return false;
  return relicsPaying(input.relicDb, part?.uniqueName ?? "", name).some((relic) =>
    shelf.relics.has(relic),
  );
}

function stepStocked(step: PathStep, shelves: TraderShelves, input: StockInputs): boolean {
  const trader = traderAt(step.where);
  const shelf = trader ? shelves[trader] : null;
  if (!shelf) return false;
  if (shelf.names.has(nameKey(input.itemName))) return true;
  if (step.quest && shelf.names.has(nameKey(step.quest))) return true;
  return step.parts.length > 0 && step.parts.every((part) => partSold(shelf, part, input));
}

/** A trader-only path walks while the trader is in and stocks what it buys. */
export function markStocked(
  paths: AcquisitionPath[],
  shelves: TraderShelves | null,
  input: StockInputs,
): void {
  if (!shelves) return;
  for (const path of paths) {
    const steps = path.steps;
    if (steps.length === 0 || !steps.every((step) => traderAt(step.where) !== null)) continue;
    if (steps.every((step) => stepStocked(step, shelves, input))) path.stocked = true;
  }
}
