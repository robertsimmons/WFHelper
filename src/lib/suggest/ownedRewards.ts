import { ownedComponentCount } from "../../../config/shared/componentNames.js";
import { resolveRewardUniqueName } from "../bountyRewards.js";
import type { ItemDbEntry } from "../../types/inventory.js";

/** Packs and bundles grant their contents, so a count of the wrapper says nothing. */
const PACK_PATH = /\/(?:BoosterPacks|Packages)\//i;

export interface OwnedReward {
  owned: number;
  /** Copies of the item already built, where the reward is its blueprint. */
  built?: number | undefined;
}

function ownedReward(
  uniqueName: string | null | undefined,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): OwnedReward | null {
  if (!uniqueName || PACK_PATH.test(uniqueName)) return null;
  const owned = ownedComponentCount(uniqueName, ownership);
  const product = itemDb[uniqueName]?.buildsProduct;
  return product ? { owned, built: ownedComponentCount(product, ownership) } : { owned };
}

/** The settings table is keyed by item name, so the count needs the item first. */
export function ownedRewardByName(
  name: string,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): OwnedReward | null {
  return ownedReward(resolveRewardUniqueName(name, itemDb), itemDb, ownership);
}

/** The count for a reward named either way, or null where none can be trusted:
 *  an ownership map is empty because no inventory was read, not because the
 *  player owns nothing. */
export function ownedRewardFor(
  reward: { name: string; uniqueName?: string | undefined } | null | undefined,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): OwnedReward | null {
  if (!reward || ownership.size === 0) return null;
  return (
    ownedReward(reward.uniqueName, itemDb, ownership) ??
    ownedRewardByName(reward.name, itemDb, ownership)
  );
}

/** A built copy counts: the blueprint is spent but the item is in hand. Null is
 *  an unread inventory, which is never "the player has none". */
export function ownsAny(owned: OwnedReward | null | undefined): boolean {
  return Boolean(owned && (owned.owned > 0 || (owned.built ?? 0) > 0));
}

/** Four characters holds every real count, so a column of them stays lined up. */
export function compactCount(count: number): string {
  if (count < 10_000) return String(count);
  if (count < 1_000_000) return `${Math.floor(count / 1_000)}k`;
  return `${Math.floor(count / 1_000_000)}M`;
}
