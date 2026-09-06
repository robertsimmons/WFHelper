import { MODULAR_PART_PATH } from "../../inventory/itemClassification.js";
import type { ItemDbEntry } from "../../../types/inventory.js";
import type { WeaponClass } from "./types.js";

const PRODUCT_CLASS: Record<string, WeaponClass> = {
  LongGuns: "primary",
  Pistols: "secondary",
  Melee: "melee",
  SpaceGuns: "archwing",
  SpaceMelee: "archwing",
  SentinelWeapons: "companion",
};

/** "Archwing" names the suit, not its guns, so only the arch-* rows count. */
const CATEGORY_CLASS: Record<string, WeaponClass> = {
  primary: "primary",
  secondary: "secondary",
  melee: "melee",
  "arch-gun": "archwing",
  "arch-melee": "archwing",
};

const PATH_CLASS: Array<[RegExp, WeaponClass]> = [
  [/\/SpaceGuns?\//i, "archwing"],
  [/\/SpaceMelee\//i, "archwing"],
  [/\/Sentinels\/[^/]*Weapons?\//i, "companion"],
  [/\/LongGuns\//i, "primary"],
  [/\/Pistols\//i, "secondary"],
  [/\/Melee\//i, "melee"],
];

/** Recipes, store fronts, quest props and cosmetics are never a target. */
const EXCLUDED_PATH =
  /\/(?:Recipes|StoreItems|OperatorLoadOuts|QuestVersions|PrototypeVersions|Cosmetics?|Decorations?|Enemies|NPC|Test|Developers?)\//i;

/** Mods, stances, skins and bait all sit under the weapon path they belong to,
 *  and the item DB holds more of them than it holds weapons. */
const NOT_A_WEAPON_CATEGORY = /^(?:mod|cosmetic|skin|resource|gear|arcane)$/i;

/** Exalted gear is granted by the frame that carries it, so it is not farmed.
 *  It reaches the item DB flagged, typed, or only by its Powersuits path. */
const EXALTED_PATH = /\/(?:ExaltedWeapons?|SpecialItems|Powersuits)\//i;

const FIXED_GUN = /\/FixedGun/i;

/** Amps, K-Drives and Railjack armaments are masterable but not built like a weapon. */
const NOT_A_WEAPON_PATH = /\/(?:OperatorAmps?|OperatorAmplifiers?|Hoverboards?|CrewShip)/i;

export interface WeaponEntry {
  uniqueName: string;
  entry: ItemDbEntry;
  name: string;
  weaponClass: WeaponClass;
}

function excluded(uniqueName: string, entry: ItemDbEntry): boolean {
  if (entry.exalted === true || entry.isBuildComponent === true) return true;
  if (entry.masterable === false) return true;
  if (NOT_A_WEAPON_CATEGORY.test(String(entry.category ?? ""))) return true;
  if (entry.productCategory === "SpecialItems") return true;
  if (typeof entry.type === "string" && /exalted/i.test(entry.type)) return true;
  if (EXALTED_PATH.test(uniqueName)) return true;
  if (EXCLUDED_PATH.test(uniqueName)) return true;
  if (NOT_A_WEAPON_PATH.test(uniqueName)) return true;
  if (MODULAR_PART_PATH.test(uniqueName)) return true;
  if (FIXED_GUN.test(uniqueName)) return true;
  const name = String(entry.name ?? "").toLowerCase();
  return name.endsWith(" blueprint") || name.endsWith(" component");
}

/** Null for anything that is not a weapon the player can go and get. */
export function weaponClass(
  uniqueName: string,
  entry: ItemDbEntry | undefined,
): WeaponClass | null {
  if (!entry?.name) return null;
  if (excluded(uniqueName, entry)) return null;
  const product = PRODUCT_CLASS[String(entry.productCategory ?? "")];
  if (product) return product;
  const category = CATEGORY_CLASS[String(entry.category ?? "").toLowerCase()];
  if (category) return category;
  for (const [pattern, weapon] of PATH_CLASS) {
    if (pattern.test(uniqueName)) return weapon;
  }
  return null;
}

export function isWeaponEntry(uniqueName: string, entry: ItemDbEntry | undefined): boolean {
  return weaponClass(uniqueName, entry) !== null;
}

export function listWeapons(itemDb: Record<string, ItemDbEntry>): WeaponEntry[] {
  const seen = new Set<string>();
  const out: WeaponEntry[] = [];
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    const weapon = weaponClass(uniqueName, entry);
    if (!weapon) continue;
    const name = String(entry.name);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ uniqueName, entry, name, weaponClass: weapon });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const PRIME_SUFFIX = /\s+prime$/i;

/** The base a Prime upgrades, by name; null for anything that is not a Prime. */
export function baseWeaponName(name: string): string | null {
  return PRIME_SUFFIX.test(name) ? name.replace(PRIME_SUFFIX, "").trim() : null;
}
