import { missionOpinion } from "../missionTypes.js";
import { RELIC_PACK_POOL } from "../relicPacks.js";
import { traderRelics } from "../traderRelics.js";
import { relicsPaying } from "./plan/prime.js";
import type { RelicDatabase, RelicGroup, RelicSource } from "../../../types/relics.js";
import type { MissionOpinion, SuggestionPreferences } from "../../../types/suggest.js";
import type { WorldState } from "../../../types/world.js";
import type { PartState } from "./types.js";

/** Modes whose rotations run A, A, B, C round by round. */
const AABC = new Set([
  "alchemy",
  "conjunction survival",
  "defection",
  "defense",
  "disruption",
  "excavation",
  "infested salvage",
  "interception",
  "mirror defense",
  "survival",
  "void armageddon",
  "void cascade",
  "void flood",
]);

const OPINION_RANK: Record<MissionOpinion, number> = { good: 0, bad: 2 };
const UNRATED_RANK = 1;
const NO_SOURCE_RANK = 3;

export type AabcRound = "A" | "B" | "C";

export interface RankedSource extends RelicSource {
  opinion: MissionOpinion | null;
  /** Set only for an endless mode, whose rotation letter names its round. */
  round: AabcRound | null;
}

export interface RelicVendor {
  trader: "varzia" | "baro";
  aya: number | null;
  ducats: number | null;
  credits: number | null;
}

export interface NeededRelic {
  group: RelicGroup;
  /** Still-missing parts it pays. */
  parts: string[];
  /** Null until the drop tables load. */
  sources: RankedSource[] | null;
  /** Null when no world state says who is in town. */
  vendors: RelicVendor[] | null;
  /** In the pool syndicate and Steel Path relic packs roll from. */
  pack: boolean;
}

export function aabcRound(source: RelicSource): AabcRound | null {
  const rotation = source.rotation;
  if (rotation !== "A" && rotation !== "B" && rotation !== "C") return null;
  if (source.kind !== "mission" || !source.missionType) return null;
  return AABC.has(source.missionType.toLowerCase()) ? rotation : null;
}

/** A bounty is an open-world run. */
export function sourceOpinion(
  prefs: SuggestionPreferences,
  source: RelicSource,
): MissionOpinion | null {
  if (source.kind === "bounty") return missionOpinion(prefs, "Open World");
  if (source.kind !== "mission" && source.kind !== "caches") return null;
  return missionOpinion(prefs, source.missionType);
}

function opinionRank(opinion: MissionOpinion | null): number {
  return opinion ? OPINION_RANK[opinion] : UNRATED_RANK;
}

/** The player's liked modes first, disliked last, then the better odds. */
export function rankSources(
  prefs: SuggestionPreferences,
  sources: readonly RelicSource[],
): RankedSource[] {
  return sources
    .map((source) => ({
      ...source,
      opinion: sourceOpinion(prefs, source),
      round: aabcRound(source),
    }))
    .sort(
      (a, b) =>
        opinionRank(a.opinion) - opinionRank(b.opinion) ||
        b.chance - a.chance ||
        a.place.localeCompare(b.place),
    );
}

function relicVendors(
  group: RelicGroup,
  db: RelicDatabase,
  world: WorldState | null,
  nowMs: number,
): RelicVendor[] | null {
  if (!world) return null;
  const out: RelicVendor[] = [];
  const shelves = [
    ["varzia", traderRelics(world.vaultTrader, db, nowMs)],
    ["baro", traderRelics(world.voidTrader, db, nowMs)],
  ] as const;
  for (const [trader, shelf] of shelves) {
    const offer = shelf?.relics.find((entry) => entry.group.key === group.key)?.offer;
    if (!offer) continue;
    out.push({
      trader,
      aya: typeof offer.aya === "number" ? offer.aya : null,
      ducats: typeof offer.ducats === "number" ? offer.ducats : null,
      credits: typeof offer.credits === "number" ? offer.credits : null,
    });
  }
  return out;
}

function bestSource(relic: NeededRelic): number[] {
  const best = relic.sources?.[0];
  const sold = (relic.vendors?.length ?? 0) > 0 || relic.pack;
  if (!best) return [sold ? UNRATED_RANK : NO_SOURCE_RANK, 0];
  return [opinionRank(best.opinion), -best.chance];
}

function compareRelics(a: NeededRelic, b: NeededRelic): number {
  const left = bestSource(a);
  const right = bestSource(b);
  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    if (value !== other) return value - other;
  }
  return a.group.name.localeCompare(b.group.name, undefined, { numeric: true });
}

/** Every relic paying a part the player still lacks, with where to get it. */
export function neededRelics(
  missing: readonly PartState[],
  db: RelicDatabase,
  prefs: SuggestionPreferences,
  world: WorldState | null,
  nowMs: number,
  pool: readonly string[] = RELIC_PACK_POOL,
): NeededRelic[] {
  const parts = new Map<string, string[]>();
  for (const part of missing) {
    if (part.missing <= 0) continue;
    for (const relic of relicsPaying(db, part.uniqueName, part.name)) {
      const list = parts.get(relic) ?? [];
      if (!list.includes(part.name)) list.push(part.name);
      parts.set(relic, list);
    }
  }
  const packed = new Set(pool);
  const out: NeededRelic[] = [];
  for (const [name, paid] of parts) {
    const group = db.groups[name];
    if (!group) continue;
    out.push({
      group,
      parts: paid,
      sources: group.sources ? rankSources(prefs, group.sources) : null,
      vendors: relicVendors(group, db, world, nowMs),
      pack: packed.has(group.name),
    });
  }
  return out.sort(compareRelics);
}
