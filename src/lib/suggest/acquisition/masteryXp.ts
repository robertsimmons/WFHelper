import type { MasteryData } from "../../../types/inventory.js";
import type { AcquisitionKind, AcquisitionTarget, ModularGear } from "./types.js";

const BASE_MAX_RANK = 30;
const OVERCAP_MAX_RANK = 40;

/** Suits bank 200 mastery a rank and weapons 100, as the inventory's own
 *  affinity curves have it; an amp ranks on the weapon curve. */
const SUIT_PER_RANK = 200;
const WEAPON_PER_RANK = 100;

const KIND_PER_RANK: Record<Exclude<AcquisitionKind, "modular">, number> = {
  warframe: SUIT_PER_RANK,
  archwing: SUIT_PER_RANK,
  sentinel: SUIT_PER_RANK,
  beast: SUIT_PER_RANK,
  necramech: SUIT_PER_RANK,
  plexus: SUIT_PER_RANK,
  weapon: WEAPON_PER_RANK,
};

const GEAR_PER_RANK: Record<ModularGear, number> = {
  moa: SUIT_PER_RANK,
  hound: SUIT_PER_RANK,
  kdrive: SUIT_PER_RANK,
  amp: WEAPON_PER_RANK,
  kitgun: WEAPON_PER_RANK,
  zaw: WEAPON_PER_RANK,
};

const OVERCAP_NAME = /(?:^|\s)(?:kuva|tenet|coda)\s|^paracesis$/i;

/** The roster's max rank, which reads DE's export; null where it has no row. */
export function createMaxRankLookup(
  mastery: MasteryData | null | undefined,
): (uniqueName: string, name: string) => number | null {
  const byKey = new Map<string, number>();
  for (const item of mastery?.items ?? []) {
    if (typeof item.maxRank !== "number" || item.maxRank <= 0) continue;
    if (item.uniqueName) byKey.set(item.uniqueName, item.maxRank);
    if (item.name) byKey.set(item.name.toLowerCase(), item.maxRank);
  }
  return (uniqueName, name) => byKey.get(uniqueName) ?? byKey.get(name.toLowerCase()) ?? null;
}

function fallbackMaxRank(target: AcquisitionTarget): number {
  if (target.modular) return BASE_MAX_RANK;
  if (target.kind === "necramech" || target.nemesis) return OVERCAP_MAX_RANK;
  return OVERCAP_NAME.test(target.name) ? OVERCAP_MAX_RANK : BASE_MAX_RANK;
}

/** What ranking the item to max banks; a gear type counts one head part's build. */
export function masteryXp(target: AcquisitionTarget): number {
  const perRank = target.modular
    ? GEAR_PER_RANK[target.modular.gear]
    : target.kind === "modular"
      ? WEAPON_PER_RANK
      : KIND_PER_RANK[target.kind];
  return perRank * (target.maxRank ?? fallbackMaxRank(target));
}
