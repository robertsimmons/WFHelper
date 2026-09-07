import incarnons from "../../../data/suggest/incarnons.json";
import { nameKey } from "./curated.js";
import type { ItemDbEntry, RawInventoryData } from "../../../types/inventory.js";
import type { IncarnonInfo } from "./types.js";

interface IncarnonRow {
  grade?: unknown;
  upgradePath?: unknown;
  source?: unknown;
  week?: unknown;
}

/** EquipmentFeatures.INCARNON_GENESIS: set on the weapon once the adapter is
 *  installed, at which point the adapter has left MiscItems. */
const INSTALLED_FEATURE = 512;

const ADAPTER_PATH = "/IncarnonAdapters/";
const ADAPTER_SUFFIX = / incarnon genesis$/;

/** One adapter fits every variant of its weapon, so ownership folds the prefixes
 *  and suffixes DE hangs off a base name. Kuva and Tenet are left alone: they are
 *  weapons in their own right, not variants of the base. */
function adapterKey(name: string): string {
  return nameKey(
    name
      .replace(/^(MK1-|Prisma |Mara |Dex )/i, "")
      .replace(/ (Prime|Vandal|Wraith)$/i, "")
      .trim(),
  ).replace(ADAPTER_SUFFIX, "");
}

/** The table names the base weapon, so only the base carries the adapter need;
 *  the variants share the win without each asking for it again. */
const TABLE = new Map<string, IncarnonRow>(
  Object.entries(incarnons as Record<string, IncarnonRow>).map(([name, row]) => [
    nameKey(name),
    row,
  ]),
);

const WEAPON_SLICES = ["LongGuns", "Pistols", "Melee"] as const;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function week(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface IncarnonLookup {
  /** Null when no adapter is known for the weapon. */
  (name: string): IncarnonInfo | null;
}

/** Adapter names the player holds uninstalled, plus the weapons they are fitted to. */
function ownedAdapterKeys(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): Set<string> {
  const owned = new Set<string>();
  if (!inventory) return owned;
  for (const row of (inventory.MiscItems ?? []) as Array<{ ItemType?: string }>) {
    if (!row.ItemType?.includes(ADAPTER_PATH)) continue;
    const name = itemDb[row.ItemType]?.name;
    if (name) owned.add(adapterKey(name));
  }
  for (const slice of WEAPON_SLICES) {
    for (const row of (inventory[slice] ?? []) as Array<{ ItemType?: string; Features?: number }>) {
      if (!row.ItemType) continue;
      if (typeof row.Features !== "number" || !(row.Features & INSTALLED_FEATURE)) continue;
      const name = itemDb[row.ItemType]?.name;
      if (name) owned.add(adapterKey(name));
    }
  }
  return owned;
}

/** Only a Circuit adapter is something to go and get: a Zariman or Sanctum
 *  Incarnon is built into the weapon, so owning the weapon is the whole win. */
export function createIncarnonLookup(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): IncarnonLookup {
  const owned = ownedAdapterKeys(inventory, itemDb);
  return (name) => {
    const row = TABLE.get(nameKey(name));
    if (!row || text(row.source) !== "circuit") return null;
    return {
      grade: text(row.grade),
      upgradePath: text(row.upgradePath),
      week: week(row.week),
      owned: owned.has(adapterKey(name)),
    };
  };
}
