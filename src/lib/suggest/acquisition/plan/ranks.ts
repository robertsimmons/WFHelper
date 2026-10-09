import { SYNDICATE_RANKS } from "../../../../data/syndicateRanks.js";
import { syndicateStatus } from "../../../syndicates/rankup.js";
import type { SyndicateMeta } from "../../../../../config/shared/syndicateTypes.js";
import type { RawInventoryData } from "../../../../types/inventory.js";
import type { PlanRank } from "./schema.js";

const LEADING_THE = /^the\s+/i;

function rankKey(name: string): string {
  return name.trim().replace(LEADING_THE, "").toLowerCase();
}

const BY_NAME = new Map(SYNDICATE_RANKS.map((meta) => [rankKey(meta.name), meta]));

/** "The Hex" and "Hex" both name the Hex. */
export function rankSyndicate(name: string): SyndicateMeta | null {
  return BY_NAME.get(rankKey(name)) ?? null;
}

export function topRank(meta: SyndicateMeta): number {
  return meta.titles.reduce((max, title) => Math.max(max, title.level), 0);
}

/** Null when the payload carries no standing at all, which is unknown. */
export function rankMet(inventory: RawInventoryData | null, rank: PlanRank): boolean | null {
  const meta = rankSyndicate(rank.syndicate);
  if (!meta || !Array.isArray(inventory?.Affiliations)) return null;
  const status = syndicateStatus(inventory, meta);
  return status.nextLevel === null || status.level >= rank.level;
}
