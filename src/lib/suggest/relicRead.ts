import { QUALITY_MODES } from "../relic/relicConstants.js";
import { getCachedPriceState } from "../wfm/priceCache.js";
import { buildOwnership } from "./acquisition/parts.js";
import { resolveRewardUniqueName } from "../bountyRewards.js";
import { pendingBuildCounts } from "../../../config/shared/foundryPending.js";
import { normalizeDucats } from "../../../config/shared/numeric.js";
import {
  masteredKeys,
  relicAdvice,
  relicMr,
  relicRarity,
  type RelicAdvice,
  type RelicMr,
  type RelicRewardMr,
} from "../../../config/shared/relicMr.js";
import { rendererPriceCacheKey } from "../../../config/shared/wfmCacheKeys.js";
import type { ItemDbEntry } from "../../types/inventory.js";
import type { RelicGroup, RelicQuality, RelicReward } from "../../types/relics.js";
import type { SuggestionContext } from "../../types/suggest.js";

export function platPrice(reward: RelicReward): number | null {
  if (!reward.urlName) return null;
  const entry = getCachedPriceState(rendererPriceCacheKey(reward.urlName, null));
  return entry?.status === "ok" ? entry.median : null;
}

export interface MrInputs {
  ownership: Map<string, number>;
  pending: Map<string, number>;
  mastered: Set<string>;
}

type MrSources = Pick<SuggestionContext, "inventory" | "itemDb" | "mastery">;

/** One ownership read per inventory, item database and roster: every toggle
 *  would walk the whole inventory again otherwise. */
let mrInputsCache: (MrSources & { inputs: MrInputs }) | null = null;

export function mrInputs(sources: MrSources): MrInputs {
  const { inventory, itemDb, mastery } = sources;
  if (
    mrInputsCache?.inventory === inventory &&
    mrInputsCache.itemDb === itemDb &&
    mrInputsCache.mastery === mastery
  ) {
    return mrInputsCache.inputs;
  }
  const inputs: MrInputs = {
    ownership: buildOwnership(inventory, itemDb),
    pending: pendingBuildCounts(
      inventory?.PendingRecipes,
      (uniqueName) => itemDb[uniqueName]?.buildsProduct,
    ),
    mastered: masteredKeys(mastery?.items ?? []),
  };
  mrInputsCache = { inventory, itemDb, mastery, inputs };
  return inputs;
}

/** The relic table keys a component by the recipe path `@wfcd/items` gave it,
 *  which the item database does not carry, so the name is what actually joins. */
export function rewardUniqueName(
  reward: RelicReward,
  itemDb: Record<string, ItemDbEntry>,
): string | undefined {
  return resolveRewardUniqueName(reward.name, itemDb) ?? reward.uniqueName ?? undefined;
}

/** Every refinement names the same drops, so any one table answers for them. */
export function referenceTable(
  group: RelicGroup,
): { quality: RelicQuality; rewards: RelicReward[] } | null {
  for (const quality of QUALITY_MODES) {
    const rewards = group.qualities[quality]?.rewards ?? [];
    if (rewards.length > 0) return { quality, rewards };
  }
  return null;
}

export interface GroupRead {
  mr: RelicMr;
  byName: Map<string, RelicRewardMr>;
  advice: RelicAdvice;
}

export function readGroup(
  group: RelicGroup,
  itemDb: Record<string, ItemDbEntry>,
  inputs: MrInputs,
): GroupRead | null {
  const table = referenceTable(group);
  if (!table) return null;
  const mr = relicMr({
    rewards: table.rewards.map((reward) => ({
      name: reward.name,
      uniqueName: rewardUniqueName(reward, itemDb),
    })),
    itemDb,
    ...inputs,
  });
  const advice = relicAdvice(
    table.rewards.map((reward, index) => ({
      rarity: relicRarity(table.quality, reward),
      platinum: platPrice(reward),
      ducats: normalizeDucats(reward.ducats),
      status: mr.rewards[index]?.status ?? null,
    })),
  );
  return { mr, byName: new Map(mr.rewards.map((row) => [row.name, row])), advice };
}
