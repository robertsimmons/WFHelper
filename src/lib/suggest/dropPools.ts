import { RIVEN_CARD_URL } from "../assetUrls.js";
import { resolveRewardIcon, resolveRewardUniqueName } from "../bountyRewards.js";
import type { DropRow } from "../../../config/shared/dropTypes.js";
import type { ItemDbEntry } from "../../types/inventory.js";

/** Null means unrated; the caller supplies the rating so the tables stay out of here. */
type RewardRating = (name: string) => number | null;

export interface DropPoolMember {
  /** Exact drop-table name, count prefix and all, for the itemDb join. */
  item: string;
  /** The same name with any count prefix stripped. */
  name: string;
  chance: number;
}

export interface DropFamily {
  /** Pluralised family name, or the lone member's own full name. */
  label: string;
  /** Everything the family holds, best roll first. Several members mean the
   *  reward is one of them, so no single name stands for the family. */
  members: DropPoolMember[];
  /** One member per modifier depth, best first: what to picture where the
   *  family holds more than one. */
  variants: DropPoolMember[];
  chance: number;
}

interface DropArt {
  imageUrl: string;
  name: string;
}

const COUNT_PREFIX = /^\d[\d,]*\s*[xk]?\s+/i;

function displayName(item: string): string {
  return item.replace(/\s+/g, " ").trim().replace(COUNT_PREFIX, "").trim();
}

function familyKey(name: string): string {
  const words = name.split(" ");
  return words.length <= 2 ? name : words.slice(-2).join(" ");
}

function pluralize(name: string): string {
  return name.endsWith("s") ? name : `${name}s`;
}

function byChance(a: DropPoolMember, b: DropPoolMember): number {
  return b.chance - a.chance || a.item.localeCompare(b.item);
}

/** One item can sit in several tables of the same pool; the best roll wins.
 *  A null rating rates nothing away, which is what a listing wants. */
function bestByName(rows: readonly DropRow[], rated: RewardRating | null): DropPoolMember[] {
  const best = new Map<string, DropPoolMember>();
  for (const row of rows) {
    if (rated && rated(row.item) === null) continue;
    const name = displayName(row.item);
    if (!name) continue;
    const existing = best.get(name);
    if (!existing || row.chance > existing.chance) {
      best.set(name, { item: row.item, name, chance: row.chance });
    }
  }
  return [...best.values()];
}

/** Everything a pool can pay, best roll first. Nothing is rated away: a name the
 *  worth ladder has no opinion about still drops, so a listing still shows it. */
export function dropPoolRows(rows: readonly DropRow[]): DropPoolMember[] {
  return bestByName(rows, null).sort(byChance);
}

/** A longer name is a modified variant of a shorter one - a Tauforged shard
 *  against a plain one - so one member per name length pictures what the family
 *  spans without claiming which of them a run pays. */
function variantsOf(members: readonly DropPoolMember[]): DropPoolMember[] {
  const depths = new Map<number, DropPoolMember[]>();
  for (const member of members) {
    const depth = member.name.split(" ").length;
    const bucket = depths.get(depth);
    if (bucket) bucket.push(member);
    else depths.set(depth, [member]);
  }
  return [...depths.values()]
    .map((bucket) => ({
      top: [...bucket].sort(byChance)[0],
      chance: bucket.reduce((sum, member) => sum + member.chance, 0),
    }))
    .sort((a, b) => b.chance - a.chance || a.top.item.localeCompare(b.top.item))
    .map((variant) => variant.top);
}

/** What an activity pays, as at most `limit` reward families ordered by summed
 *  chance. The limit is the card line's, which holds one row of labels; a
 *  listing reads `dropPoolRows` instead. */
export function summarizeDropPool(
  rows: readonly DropRow[],
  rated: RewardRating,
  limit = 3,
): DropFamily[] {
  const families = new Map<string, DropPoolMember[]>();
  for (const member of bestByName(rows, rated)) {
    const key = familyKey(member.name);
    const bucket = families.get(key);
    if (bucket) bucket.push(member);
    else families.set(key, [member]);
  }

  const summarized = [...families.entries()].map(([key, members]) => {
    const sorted = [...members].sort(byChance);
    return {
      label: sorted.length > 1 ? pluralize(key) : sorted[0].name,
      members: sorted,
      variants: variantsOf(sorted),
      chance: members.reduce((sum, member) => sum + member.chance, 0),
    };
  });

  summarized.sort((a, b) => b.chance - a.chance || a.label.localeCompare(b.label));
  return summarized.slice(0, limit);
}

/** Calendar packs sit in no item export, so nothing joins them to art. Each
 *  stands in with something the pack itself grants. */
const PACK_ART_STAND_IN: Record<string, string> = {
  "/Lotus/Types/StoreItems/Packages/Calendar/CalendarKuvaBundleSmall":
    "/Lotus/Types/Items/MiscItems/Kuva",
  "/Lotus/Types/StoreItems/Packages/Calendar/CalendarKuvaBundleLarge":
    "/Lotus/Types/Items/MiscItems/Kuva",
  "/Lotus/Types/BoosterPacks/CalendarArtifactPack":
    "/Lotus/Upgrades/CosmeticEnhancers/Offensive/AbilityStrengthForMaxHealth",
  "/Lotus/Types/BoosterPacks/CalendarMajorArtifactPack":
    "/Lotus/Upgrades/CosmeticEnhancers/Offensive/AbilityStrengthForMaxHealth",
};

/** A riven is rolled per player, so no item export pictures the one on offer and
 *  the name-based lookup would settle for the flat mod icon. DE ships one
 *  randomized mod per weapon class, and each of those carries the veiled card
 *  art the wiki mirrors. */
const RIVEN_MOD = /\briven mods?\b/i;

/** Longest first, so "Companion Weapon" is not read as a plain rifle. */
const RIVEN_CLASSES = [
  "Companion Weapon",
  "Archgun",
  "Shotgun",
  "Kitgun",
  "Pistol",
  "Melee",
  "Rifle",
  "Zaw",
] as const;

/** A pool that names no class means any of them, and the rifle card is the one
 *  that reads as "a riven". */
const GENERIC_RIVEN_CLASS = "Rifle";

/** The veiled card for the class the reward names, off the item database, whose
 *  riven entries already carry the mirrored card art. The bundled card stands in
 *  where no database has been read. */
function rivenArt(itemDb: Record<string, ItemDbEntry>, name: string): DropArt {
  const lower = name.toLowerCase();
  const weapon = RIVEN_CLASSES.find((riven) => lower.includes(riven.toLowerCase()));
  const uniqueName = resolveRewardUniqueName(`${weapon ?? GENERIC_RIVEN_CLASS} Riven Mod`, itemDb);
  const imageUrl = uniqueName ? itemDb[uniqueName]?.imageUrl : undefined;
  return { imageUrl: imageUrl || RIVEN_CARD_URL, name };
}

/** uniqueName first because calendar rewards carry one; otherwise by display name. */
export function resolveDropArt(
  itemDb: Record<string, ItemDbEntry>,
  item: string,
  uniqueName?: string | undefined,
): DropArt | null {
  const entry = uniqueName ? itemDb[uniqueName] : undefined;
  if (entry?.imageUrl) {
    return { imageUrl: entry.imageUrl, name: entry.displayName || entry.name || displayName(item) };
  }
  const standIn = uniqueName ? itemDb[PACK_ART_STAND_IN[uniqueName] ?? ""] : undefined;
  if (standIn?.imageUrl) return { imageUrl: standIn.imageUrl, name: displayName(item) };
  if (RIVEN_MOD.test(item)) return rivenArt(itemDb, displayName(item));
  const imageUrl = resolveRewardIcon(item, itemDb);
  return imageUrl ? { imageUrl, name: displayName(item) } : null;
}
