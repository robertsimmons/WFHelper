/** DE chance bands mislabel relic commons, so derive rarity from refinement and chance. */

export type RelicRefinement = "intact" | "exceptional" | "flawless" | "radiant";

const CHANCE_RARITY: Record<RelicRefinement, [number, string][]> = {
  intact: [
    [25.33, "Common"],
    [11, "Uncommon"],
    [2, "Rare"],
  ],
  exceptional: [
    [23.33, "Common"],
    [13, "Uncommon"],
    [4, "Rare"],
  ],
  flawless: [
    [20, "Common"],
    [17, "Uncommon"],
    [6, "Rare"],
  ],
  radiant: [
    [16.67, "Common"],
    [20, "Uncommon"],
    [10, "Rare"],
  ],
};

/** Real rarity for a relic reward, or the fallback when chance doesn't match. */
export function relicRewardRarity(refinement: string, chance: number, fallback = "Common"): string {
  const table = CHANCE_RARITY[refinement.toLowerCase() as RelicRefinement];
  if (!table) return fallback;
  for (const [expected, rarity] of table) {
    if (Math.abs(chance - expected) < 0.5) return rarity;
  }
  return fallback;
}

/** The chance a refinement pays one reward of a rarity; DE's export names only the rarity. */
export function relicRewardChance(refinement: RelicRefinement, rarity: string): number | null {
  const wanted = rarity.toLowerCase();
  const row = CHANCE_RARITY[refinement].find(([, label]) => label.toLowerCase() === wanted);
  return row ? row[0] : null;
}

/** Refinement parsed from a drop location like "Meso L5 Relic (Radiant)"; bare = intact. */
export function relicRefinementFromLocation(location: string): RelicRefinement {
  const match = /\((Intact|Exceptional|Flawless|Radiant)\)/i.exec(location);
  return (match ? match[1].toLowerCase() : "intact") as RelicRefinement;
}

function isRelicDropLocation(location: string): boolean {
  return /\bRelic\b/i.test(location);
}

/** Corrected rarity for a {location, chance} drop row; non-relic rows pass through. */
export function correctedDropRarity(location: string, chance: number, rarity: string): string {
  if (!isRelicDropLocation(location)) return rarity;
  return relicRewardRarity(relicRefinementFromLocation(location), chance, rarity);
}
