import { ownedComponentCount } from "../../../config/shared/componentNames.js";
import { resolveRewardUniqueName } from "../bountyRewards.js";
import type { ItemDbEntry } from "../../types/inventory.js";

/** Packs and bundles grant their contents, so a count of the wrapper says nothing. */
const PACK_PATH = /\/(?:BoosterPacks|Packages)\//i;

interface OwnedReward {
  owned: number;
  /** Copies of the item already built, where the reward is its blueprint. */
  built?: number | undefined;
}

export function ownedReward(
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

/** Four characters holds every real count, so a column of them stays lined up. */
export function compactCount(count: number): string {
  if (count < 10_000) return String(count);
  if (count < 1_000_000) return `${Math.floor(count / 1_000)}k`;
  return `${Math.floor(count / 1_000_000)}M`;
}
