import { RIVEN_TEMPLATE_URL } from "../assetUrls.js";
import { resolveRewardIcon } from "../bountyRewards.js";
import type { DropRow } from "../../../config/shared/dropTypes.js";
import type { ItemDbEntry } from "../../types/inventory.js";

/** Null means unrated; the caller supplies the rating so the tables stay out of here. */
type RewardRating = (name: string) => number | null;

interface DropFamily {
  /** Pluralised family name, or the lone member's own full name. */
  label: string;
  /** Exact drop-table name of the top member, for the itemDb join. */
  item: string;
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

interface Member {
  item: string;
  display: string;
  chance: number;
}

/** One item can sit in several tables of the same pool; the best roll wins. */
function bestByName(rows: readonly DropRow[], rated: RewardRating): Member[] {
  const best = new Map<string, Member>();
  for (const row of rows) {
    if (rated(row.item) === null) continue;
    const display = displayName(row.item);
    if (!display) continue;
    const existing = best.get(display);
    if (!existing || row.chance > existing.chance) {
      best.set(display, { item: row.item, display, chance: row.chance });
    }
  }
  return [...best.values()];
}

/** What an activity pays, as at most `limit` reward families ordered by summed chance. */
export function summarizeDropPool(
  rows: readonly DropRow[],
  rated: RewardRating,
  limit = 3,
): DropFamily[] {
  const families = new Map<string, Member[]>();
  for (const member of bestByName(rows, rated)) {
    const key = familyKey(member.display);
    const bucket = families.get(key);
    if (bucket) bucket.push(member);
    else families.set(key, [member]);
  }

  const summarized = [...families.entries()].map(([key, members]) => {
    const sorted = [...members].sort((a, b) => b.chance - a.chance || a.item.localeCompare(b.item));
    const top = sorted[0];
    return {
      label: sorted.length > 1 ? pluralize(key) : top.display,
      item: top.item,
      chance: members.reduce((sum, m) => sum + m.chance, 0),
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

/** A riven is rolled per player, so no item export pictures one and the name-based
 *  lookup would settle for the generic mod icon. The weapon class varies, the
 *  blank riven card does not. */
const RIVEN_MOD = /\briven mods?\b/i;

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
  if (RIVEN_MOD.test(item)) return { imageUrl: RIVEN_TEMPLATE_URL, name: displayName(item) };
  const imageUrl = resolveRewardIcon(item, itemDb);
  return imageUrl ? { imageUrl, name: displayName(item) } : null;
}
