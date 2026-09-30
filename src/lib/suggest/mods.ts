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

// A glob rather than an import: the data build owns the file and it may not exist.
const loaded = import.meta.glob("../../data/suggest/mods.json", { eager: true });

export const POPULAR_MODS: readonly PopularUpgrade[] = parsePopularList(shippedModule(loaded));

function isModEntry(entry: ItemDbEntry): boolean {
  return entry.mod !== undefined || entry.category === "Mod" || entry.category === "Mods";
}

const modIndex = createNameIndex(isModEntry, (entry) => entry.mod !== undefined);

const MOD_COLLECTIONS = ["Upgrades", "RawUpgrades"] as const;

/** Lowercased English names of every mod the inventory holds, ranked or not. */
export function ownedModNames(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): Map<string, number> {
  const owned = new Map<string, number>();
  if (!inventory) return owned;
  for (const key of MOD_COLLECTIONS) {
    for (const row of inventory[key] ?? []) {
      const name = row.ItemType ? itemDb[row.ItemType]?.name : undefined;
      if (name) owned.set(name.toLowerCase(), 1);
    }
  }
  return owned;
}

/** @wfcd shouts the generic slots (`WARFRAME`, `AURA`) and not the named ones. */
function slotLabel(entry: ItemDbEntry | undefined): string | null {
  const compat = entry?.mod?.compatName?.trim();
  if (compat) {
    return compat.length > 2 && compat === compat.toUpperCase()
      ? compat.charAt(0) + compat.slice(1).toLowerCase()
      : compat;
  }
  const type = entry?.type?.replace(/\s+Mod$/i, "").trim();
  return type ? type : null;
}

function ownsMod(name: string, holdings: Holdings): boolean {
  return holdings?.has(name.toLowerCase()) ?? false;
}

export function buildModCard(
  mod: PopularUpgrade,
  itemDb: Record<string, ItemDbEntry>,
  holdings: Holdings,
): UpgradeCard {
  const hit = modIndex(itemDb).get(mod.name.toLowerCase());
  const entry = hit?.entry;
  const facts = entry?.mod;
  const drain =
    facts?.baseDrain != null
      ? { min: facts.baseDrain, max: facts.baseDrain + (facts.fusionLimit ?? 0) }
      : null;
  return {
    kind: "mods",
    ...commonCardFields(mod, hit),
    slot: slotLabel(entry),
    polarity: facts?.polarity ?? null,
    rarity: facts?.rarity ?? null,
    drain,
    stats: facts?.maxRankStats ?? [],
    owned: ownsMod(mod.name, holdings),
    copies: null,
  };
}

export const MOD_CATALOG: UpgradeCatalog = {
  kind: "mods",
  popular: POPULAR_MODS,
  holdings: ownedModNames,
  owns: (name, _itemDb, holdings) => ownsMod(name, holdings),
  build: buildModCard,
};
