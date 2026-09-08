import { ownedComponentCount } from "../../../config/shared/componentNames.js";
import { currencyOwnershipKey } from "../../../config/shared/componentOwnership.js";
import {
  compactCount,
  normalizeRewardName,
  rewardNameKeys,
} from "../../../config/shared/quantityPrefix.js";
import { resolveRewardUniqueName } from "../bountyRewards.js";
import type { ItemDbEntry } from "../../types/inventory.js";

export { compactCount };

/** Packs and bundles grant their contents, so a count of the wrapper says nothing. */
const PACK_PATH = /\/(?:BoosterPacks|Packages)\//i;

/** A pack of one stacking resource counts as that resource - the 1999 calendar
 *  pays its Kuva and Vosfor through these wrappers. Packs that roll their
 *  contents still count as nothing. */
const PACK_GRANTS: Record<string, string> = {
  "/Lotus/Types/StoreItems/Packages/Calendar/CalendarKuvaBundleSmall":
    "/Lotus/Types/Items/MiscItems/Kuva",
  "/Lotus/Types/StoreItems/Packages/Calendar/CalendarKuvaBundleLarge":
    "/Lotus/Types/Items/MiscItems/Kuva",
  "/Lotus/Types/StoreItems/Packages/Calendar/CalendarVosforPack":
    "/Lotus/Types/Items/MiscItems/DistillPoints",
};

/** Endo and Dirac rewards are fusion bundles: a grant of an account balance the
 *  inventory holds no row for, so any count of one path reads zero and lies.
 *  The balance itself is readable, and the resolved name reaches it. */
const FUSION_BUNDLE_PATH = /\/FusionBundles\//i;

export interface OwnedReward {
  owned: number;
  /** Copies of the item already built, where the reward is its blueprint. */
  built?: number | undefined;
  /** Builds the foundry is running for it right now. Absent, never zero: a caller
   *  with no pending map has not read the foundry rather than found it idle. */
  pending?: number | undefined;
  /** A resource, which the player always wants more of, rather than gear that is
   *  earned once. */
  stacks?: boolean | undefined;
}

/** Mastery gear is paid for once, which is what `masterable` marks; everything
 *  else piles up. An item no export names stacks, since resources are what the
 *  reward tables are thickest with. */
export function rewardStacks(
  uniqueName: string | null | undefined,
  itemDb: Record<string, ItemDbEntry>,
): boolean {
  return !uniqueName || itemDb[uniqueName]?.masterable !== true;
}

function ownedReward(
  uniqueName: string | null | undefined,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
  foundryPending?: Map<string, number>,
): OwnedReward | null {
  const path = uniqueName ? (PACK_GRANTS[uniqueName] ?? uniqueName) : uniqueName;
  if (!path || PACK_PATH.test(path) || FUSION_BUNDLE_PATH.test(path)) return null;
  const owned = ownedComponentCount(path, ownership);
  const product = itemDb[path]?.buildsProduct;
  // One build is keyed under both its names, so a max over aliases never doubles it.
  const pending = foundryPending ? ownedComponentCount(path, foundryPending) : 0;
  const built = product ? ownedComponentCount(product, ownership) : 0;
  // A path no export names is not a path the player owns none of: it is a path
  // the reward was spelled wrong under, and its name still has a chance.
  if (owned === 0 && built === 0 && pending === 0 && !itemDb[path]) return null;
  return {
    owned,
    stacks: rewardStacks(path, itemDb),
    ...(product ? { built } : {}),
    ...(pending > 0 ? { pending } : {}),
  };
}

/** Endo, credits, platinum and Regal Aya are account balances rather than
 *  inventory rows, and a currency is always worth more of. */
function ownedCurrency(name: string, ownership: Map<string, number>): OwnedReward | null {
  for (const key of rewardNameKeys(name)) {
    const owned = ownership.get(currencyOwnershipKey(key));
    if (owned !== undefined) return { owned, stacks: true };
  }
  return null;
}

/** The settings table is keyed by item name, so the count needs the item first. */
export function ownedRewardByName(
  name: string,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
  foundryPending?: Map<string, number>,
): OwnedReward | null {
  return (
    ownedCurrency(normalizeRewardName(name), ownership) ??
    ownedReward(resolveRewardUniqueName(name, itemDb), itemDb, ownership, foundryPending)
  );
}

/** The count for a reward named either way, or null where none can be trusted:
 *  an ownership map is empty because no inventory was read, not because the
 *  player owns nothing. */
export function ownedRewardFor(
  reward: { name: string; uniqueName?: string | undefined } | null | undefined,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
  foundryPending?: Map<string, number>,
): OwnedReward | null {
  if (!reward || ownership.size === 0) return null;
  return (
    ownedReward(reward.uniqueName, itemDb, ownership, foundryPending) ??
    ownedRewardByName(reward.name, itemDb, ownership, foundryPending)
  );
}

/** A built copy counts: the blueprint is spent but the item is in hand. So does a
 *  pending one, which ownership has already deducted the blueprint for. Null is
 *  an unread inventory, which is never "the player has none". */
export function ownsAny(owned: OwnedReward | null | undefined): boolean {
  return Boolean(owned && (owned.owned > 0 || (owned.built ?? 0) > 0 || (owned.pending ?? 0) > 0));
}
