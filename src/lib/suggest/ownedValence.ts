import type { ItemDbEntry, RawInventoryData, RawInventoryEntry } from "../../types/inventory.js";

/** Every Kuva, Tenet and Coda weapon carries this one upgrade on the weapon row
 *  itself, whichever family it belongs to. */
export const VALENCE_UPGRADE_TYPE =
  "/Lotus/Weapons/Grineer/KuvaLich/Upgrades/InnateDamageRandomMod";

/** DE stores the roll as `Math.round(f * 0x3FFFFFFF)`, the same encoding riven
 *  fingerprints use. Main's decoder is main-process only, so this is the
 *  renderer's own copy of the one line that matters. */
const ROLL_SCALE = 0x3fffffff;

/** The adversary bonus window: a roll of 0 is 25% and a roll of 1 is 60%. */
export const VALENCE_FLOOR = 25;
export const VALENCE_SPAN = 35;

/** Weapon slices a nemesis weapon can land in. */
const WEAPON_SLICES = ["LongGuns", "Pistols", "Melee"] as const;

/** Fingerprint buff tags, in the element names the vendor tables use. */
const ELEMENT_BY_TAG: Record<string, string> = {
  InnateImpactDamage: "Impact",
  InnateHeatDamage: "Heat",
  InnateFreezeDamage: "Cold",
  InnateElectricityDamage: "Electricity",
  InnateToxinDamage: "Toxin",
  InnateMagDamage: "Magnetic",
  InnateRadDamage: "Radiation",
};

interface RawBuff {
  Tag?: unknown;
  Value?: unknown;
}

/** Out of range reads as 0, as the riven decoder does: a fingerprint that does
 *  not decode is not a low roll, it is a row we drop. */
export function valenceRollFloat(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const roll = value / ROLL_SCALE;
  return roll >= 0 && roll <= 1 ? roll : null;
}

/** The bonus percentage a fingerprint roll stands for, to the one decimal place
 *  the game and the wiki both report. */
export function valencePercent(value: unknown): number | null {
  const roll = valenceRollFloat(value);
  if (roll === null) return null;
  return Math.round((VALENCE_FLOOR + roll * VALENCE_SPAN) * 10) / 10;
}

/** One valence weapon the player already holds. */
export interface OwnedValence {
  uniqueName: string;
  /** English, for the by-name join against the vendor tables. */
  name: string;
  displayName?: string | undefined;
  element: string;
  percent: number;
}

function parseBuff(fingerprint: unknown): RawBuff | null {
  if (typeof fingerprint !== "string" || !fingerprint) return null;
  try {
    let parsed: unknown = JSON.parse(fingerprint);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!parsed || typeof parsed !== "object") return null;
    const buffs = (parsed as { buffs?: unknown }).buffs;
    if (!Array.isArray(buffs)) return null;
    const buff = buffs[0];
    return buff && typeof buff === "object" ? (buff as RawBuff) : null;
  } catch {
    return null;
  }
}

/** Null for any row that is not a decodable valence weapon. Identity comes from
 *  the item database, never from the shape of the `ItemType` path: a quarter of
 *  the Coda weapons carry no family word in theirs. */
function readEntry(
  entry: RawInventoryEntry,
  itemDb: Record<string, ItemDbEntry>,
): OwnedValence | null {
  if (entry.UpgradeType !== VALENCE_UPGRADE_TYPE) return null;
  const uniqueName = entry.ItemType;
  if (!uniqueName) return null;
  const item = itemDb[uniqueName];
  if (!item?.name) return null;
  const buff = parseBuff(entry.UpgradeFingerprint);
  const element = typeof buff?.Tag === "string" ? ELEMENT_BY_TAG[buff.Tag] : undefined;
  const percent = valencePercent(buff?.Value);
  if (!element || percent === null) return null;
  return {
    uniqueName,
    name: item.name,
    ...(item.displayName ? { displayName: item.displayName } : {}),
    element,
    percent,
  };
}

/** Every valence weapon in the inventory, best roll first. */
export function ownedValenceWeapons(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): OwnedValence[] {
  if (!inventory) return [];
  const owned: OwnedValence[] = [];
  for (const slice of WEAPON_SLICES) {
    for (const entry of inventory[slice] ?? []) {
      const row = readEntry(entry, itemDb);
      if (row) owned.push(row);
    }
  }
  return owned.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
}

/**
 * The best copy of each valence weapon, keyed by lowercased English name, which
 * is what the wiki-sourced vendor tables name their rows by. Fusion always works
 * from the better of two copies, so a second, worse copy changes nothing.
 */
export function ownedValenceByName(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): Map<string, OwnedValence> {
  const best = new Map<string, OwnedValence>();
  for (const row of ownedValenceWeapons(inventory, itemDb)) {
    const key = row.name.toLowerCase();
    const held = best.get(key);
    if (!held || row.percent > held.percent) best.set(key, row);
  }
  return best;
}
