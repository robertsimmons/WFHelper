import { parseAmount } from "../inventory/entryNormalization.js";
import { extractFingerprintRank } from "../inventory/rankExtraction.js";
import {
  commonCardFields,
  createNameIndex,
  parsePopularList,
  shippedModule,
  type Holdings,
  type PopularUpgrade,
  type UpgradeCard,
  type UpgradeCatalog,
} from "./upgrades.js";
import type { ItemDbEntry, RawInventoryData } from "../../types/inventory.js";

const loaded = import.meta.glob("../../data/suggest/arcanes.json", { eager: true });

export const POPULAR_ARCANES: readonly PopularUpgrade[] = parsePopularList(
  shippedModule(loaded),
);

/** Most arcanes rank to 5; Exodia, Pax, Residual and Virtuos stop at 3. */
const DEFAULT_MAX_RANK = 5;

function isArcaneEntry(entry: ItemDbEntry): boolean {
  return entry.arcane !== undefined || entry.category === "Arcane" || entry.category === "Arcanes";
}

const arcaneIndex = createNameIndex(isArcaneEntry, (entry) => entry.arcane !== undefined);

/** Rank r is paid for with 1 + 2 + ... + (r + 1) copies. */
export function copiesAtRank(rank: number): number {
  const r = Math.max(0, Math.floor(rank));
  return ((r + 1) * (r + 2)) / 2;
}

const ARCANE_COLLECTIONS = ["Upgrades", "RawUpgrades", "Arcanes"] as const;

/** Lowercased English name to copies held, every ranked stack counted back
 *  into the copies that built it. */
export function arcaneCopies(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): Map<string, number> | null {
  if (!inventory) return null;
  const held = new Map<string, number>();
  const record = inventory as Record<string, unknown>;
  for (const key of ARCANE_COLLECTIONS) {
    const rows = record[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const entry = row?.ItemType ? itemDb[row.ItemType] : undefined;
      if (!entry?.name || !isArcaneEntry(entry)) continue;
      const copies = parseAmount(row) * copiesAtRank(extractFingerprintRank(row) ?? 0);
      const name = entry.name.toLowerCase();
      held.set(name, (held.get(name) ?? 0) + copies);
    }
  }
  return held;
}

function maxCopies(entry: ItemDbEntry | undefined): number {
  return copiesAtRank(entry?.arcane?.maxRank ?? DEFAULT_MAX_RANK);
}

function copiesOf(name: string, entry: ItemDbEntry | undefined, holdings: Holdings) {
  if (!holdings) return null;
  return { held: holdings.get(name.toLowerCase()) ?? 0, max: maxCopies(entry) };
}

function ownsArcane(
  name: string,
  itemDb: Record<string, ItemDbEntry>,
  holdings: Holdings,
): boolean {
  const copies = copiesOf(name, arcaneIndex(itemDb).get(name.toLowerCase())?.entry, holdings);
  return copies !== null && copies.held >= copies.max;
}

export function buildArcaneCard(
  arcane: PopularUpgrade,
  itemDb: Record<string, ItemDbEntry>,
  holdings: Holdings,
): UpgradeCard {
  const hit = arcaneIndex(itemDb).get(arcane.name.toLowerCase());
  const facts = hit?.entry.arcane;
  const copies = copiesOf(arcane.name, hit?.entry, holdings);
  return {
    kind: "arcanes",
    ...commonCardFields(arcane, hit),
    slot: facts?.slot ?? null,
    polarity: null,
    rarity: facts?.rarity ?? null,
    drain: null,
    stats: facts?.maxRankStats ?? [],
    owned: copies !== null && copies.held >= copies.max,
    copies,
  };
}

export const ARCANE_CATALOG: UpgradeCatalog = {
  kind: "arcanes",
  popular: POPULAR_ARCANES,
  holdings: arcaneCopies,
  owns: ownsArcane,
  build: buildArcaneCard,
};
