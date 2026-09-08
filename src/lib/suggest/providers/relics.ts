import { get } from "svelte/store";

import { priceCacheRevision } from "../../../stores/pricing.js";
import { QUALITY_MODES } from "../../relic/relicConstants.js";
import { parseOwnedRelics } from "../../relic/relicInventory.js";
import { computeSquadEV } from "../../relic/relicMath.js";
import { getCachedPriceState } from "../../wfm/priceCache.js";
import { missionOpinion } from "../missionTypes.js";
import { clamp01, urgencyFromExpiry } from "../score.js";
import { normalizeDucats } from "../../../../config/shared/numeric.js";
import { rendererPriceCacheKey } from "../../../../config/shared/wfmCacheKeys.js";
import { RELIC_ERAS } from "../../../types/suggest.js";
import type { MessageKey } from "../../i18n.js";
import type { SortDirection } from "../../../types/filters.js";
import type {
  MissionOpinion,
  RelicEra,
  RelicFacts,
  RelicGoal,
  RelicSort,
  SuggestionContext,
  SuggestionDraft,
  SuggestionPreferences,
  SuggestionProvider,
} from "../../../types/suggest.js";
import type {
  OwnedQualityCounts,
  RelicDatabase,
  RelicGroup,
  RelicQuality,
  RelicReward,
} from "../../../types/relics.js";
import type { WorldState } from "../../../types/world.js";

/** The whole domain answers to one activity setting, as Nightwave's acts do. */
export const RELICS_ACTIVITY = "relics";

/** Which grade to reach for first, best held or cheapest held. */
const REFINEMENT_ORDER: Record<RelicGoal, readonly RelicQuality[]> = {
  platinum: [...QUALITY_MODES].reverse(),
  ducats: QUALITY_MODES,
};

/** A run worth this much is as good as this feed gets. */
const VALUE_REFERENCE: Record<RelicGoal, number> = { platinum: 40, ducats: 60 };

/** An unpriced relic is still worth cracking; its value cannot order it. */
const BASE_VALUE = 0.4;

const BASE_EFFORT = 0.25;
const SLOW_MISSION_EFFORT = 0.3;
const FAST_MISSION_RELIEF = 0.1;
const STEEL_PATH_EFFORT = 0.1;

/** Fissures rotate all day, so a closing one is a nudge, not a deadline. */
const FISSURE_URGENCY = 0.5;

/** Deep enough that the pager runs out only when the shelf does. Unmeasured:
 *  a lift needs a perf run behind it. */
const SUGGESTION_LIMIT = 40;

/** The details view lays the drops out as one wrapping line. */
const POOL_LIMIT = 8;

interface FissurePick {
  node: string;
  missionType: string;
  expiry: string;
  isHard: boolean;
  opinion: MissionOpinion | null;
}

function opinionRank(opinion: MissionOpinion | null): number {
  if (opinion === "good") return 0;
  return opinion === "bad" ? 2 : 1;
}

/** The mission the player would rather run, and among equals the one with the
 *  most time left on it. */
function beats(pick: FissurePick, current: FissurePick): boolean {
  const delta = opinionRank(pick.opinion) - opinionRank(current.opinion);
  if (delta !== 0) return delta < 0;
  return Date.parse(pick.expiry) > Date.parse(current.expiry);
}

/** Best live fissure per tier. A Void Storm is a Railjack run, not this. */
function fissuresByTier(
  prefs: SuggestionPreferences,
  world: WorldState | null,
  nowMs: number,
): Map<string, FissurePick> {
  const best = new Map<string, FissurePick>();
  for (const fissure of world?.fissures ?? []) {
    if (fissure.expired || fissure.isStorm) continue;
    const expiryMs = fissure.expiry ? Date.parse(fissure.expiry) : NaN;
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) continue;
    const tier = (fissure.tier ?? "").toLowerCase();
    const missionType = fissure.missionType ?? "";
    if (!tier || !missionType) continue;
    const pick: FissurePick = {
      node: fissure.node ?? "",
      missionType,
      expiry: fissure.expiry as string,
      isHard: fissure.isHard === true,
      opinion: missionOpinion(prefs, missionType),
    };
    const current = best.get(tier);
    if (!current || beats(pick, current)) best.set(tier, pick);
  }
  return best;
}

function platPrice(reward: RelicReward): number | null {
  if (!reward.urlName) return null;
  const entry = getCachedPriceState(rendererPriceCacheKey(reward.urlName, null));
  return entry?.status === "ok" ? entry.median : null;
}

function rewardValue(reward: RelicReward, goal: RelicGoal): number | null {
  return goal === "ducats" ? normalizeDucats(reward.ducats) : platPrice(reward);
}

/** Solo EV of one crack, on the same maths the Relics tab orders by. */
function expectedValue(rewards: RelicReward[], goal: RelicGoal): number | null {
  const values = rewards.map((reward) => rewardValue(reward, goal));
  if (!values.some((value) => value != null)) return null;
  return computeSquadEV(rewards, values, 1);
}

interface Held {
  quality: RelicQuality;
  count: number;
  rewards: RelicReward[];
  ev: number | null;
}

/** The refinement to run. A platinum goal wants the best grade held, because
 *  the rare is the payday; a ducat run takes the cheapest, because traces spent
 *  on ducat fodder never come back. */
function bestHeld(
  group: RelicGroup,
  counts: OwnedQualityCounts | undefined,
  goal: RelicGoal,
): Held | null {
  for (const quality of REFINEMENT_ORDER[goal]) {
    const count = counts?.[quality] ?? 0;
    if (count <= 0) continue;
    const rewards = group.qualities[quality]?.rewards ?? [];
    if (rewards.length === 0) continue;
    return { quality, count, rewards, ev: expectedValue(rewards, goal) };
  }
  return null;
}

/** What the card pictures: the drop the goal is actually chasing. */
function headlineReward(rewards: RelicReward[], goal: RelicGoal): RelicReward | null {
  let best: RelicReward | null = null;
  let bestValue = -Infinity;
  for (const reward of rewards) {
    const value = rewardValue(reward, goal);
    if (value != null && value > bestValue) {
      best = reward;
      bestValue = value;
    }
  }
  if (best) return best;
  // Nothing priced, so fall back to what a relic is remembered by.
  return rewards.reduce<RelicReward | null>(
    (rarest, reward) => (!rarest || reward.chance < rarest.chance ? reward : rarest),
    null,
  );
}

/** Both payouts, whichever goal the player picked: the card compares them. */
function relicFacts(held: Held, fissure: FissurePick): RelicFacts {
  return {
    count: held.count,
    quality: held.quality,
    node: fissure.node,
    platinum: expectedValue(held.rewards, "platinum"),
    ducats: expectedValue(held.rewards, "ducats"),
  };
}

function effortFor(fissure: FissurePick): number {
  const mission =
    fissure.opinion === "bad"
      ? SLOW_MISSION_EFFORT
      : fissure.opinion === "good"
        ? -FAST_MISSION_RELIEF
        : 0;
  return clamp01(BASE_EFFORT + mission + (fissure.isHard ? STEEL_PATH_EFFORT : 0));
}

function payoffWhy(ev: number | null, goal: RelicGoal, t: SuggestionContext["t"]): string {
  if (ev == null) {
    return t(goal === "ducats" ? "nextUp.whyRelicForDucats" : "nextUp.whyRelicForPlat");
  }
  const value = String(Math.round(ev));
  return t(goal === "ducats" ? "nextUp.whyRelicDucats" : "nextUp.whyRelicPlat", { value });
}

interface Candidate {
  group: RelicGroup;
  held: Held;
  fissure: FissurePick;
  value: number;
}

const matches = (era: RelicEra, tier: string): boolean => era.toLowerCase() === tier;

/** Vanguard relics reach the database with no box of their own, and a tier the
 *  boxes cannot name is not a tier they narrow. */
function inEras(eras: readonly RelicEra[], tier: string): boolean {
  if (eras.length === 0) return true;
  const wanted = tier.toLowerCase();
  if (!RELIC_ERAS.some((era) => matches(era, wanted))) return true;
  return eras.some((era) => matches(era, wanted));
}

/** Lower sorts earlier, as `compareAcquisition` orders the section beside this
 *  one: a payout is itself, so ascending really is the cheap end first, while a
 *  recommendation is a position, so ascending is the best of them. Null is
 *  unpriced, and sorts last whichever way the arrow points. */
function sortValue(row: Candidate, sort: RelicSort): number | null {
  if (sort === "recommended") return -row.value;
  return expectedValue(row.held.rewards, sort);
}

interface Ranked {
  row: Candidate;
  /** Read once per row: the comparator asks O(n log n) times and every answer
   *  is another squad-EV pass over the reward table. */
  key: number | null;
}

function compareRelics(direction: SortDirection): (a: Ranked, b: Ranked) => number {
  const flip = direction === "desc" ? -1 : 1;
  return (a, b) => {
    const left = a.key;
    const right = b.key;
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
    } else if (left !== right) {
      return (left - right) * flip;
    }
    // Unpriced relics all tie, so the arrow only means anything if it turns the
    // tie-break over too.
    return (b.row.value - a.row.value || a.row.group.name.localeCompare(b.row.group.name)) * flip;
  };
}

/** The shelf, parsed once per inventory: every era or sort toggle walks the
 *  same MiscItems list otherwise. */
let ownedCache: {
  inventory: SuggestionContext["inventory"];
  db: RelicDatabase;
  owned: ReturnType<typeof parseOwnedRelics>;
} | null = null;

function ownedRelics(
  inventory: SuggestionContext["inventory"],
  db: RelicDatabase,
): ReturnType<typeof parseOwnedRelics> {
  if (ownedCache?.inventory === inventory && ownedCache.db === db) return ownedCache.owned;
  const owned = parseOwnedRelics(inventory, db);
  ownedCache = { inventory, db, owned };
  return owned;
}

function candidates(
  ctx: SuggestionContext,
  goal: RelicGoal,
  fissures: Map<string, FissurePick>,
): Candidate[] {
  const db = ctx.relicDb;
  if (!db || fissures.size === 0) return [];
  const { relicEras, relicSort, relicSortDir } = ctx.prefs.options;
  const owned = ownedRelics(ctx.inventory, db);
  const rows: Candidate[] = [];

  for (const [groupKey, counts] of Object.entries(owned)) {
    const group = db.groups[groupKey];
    if (!group) continue;
    if (!inEras(relicEras, group.tier || "")) continue;
    const fissure = fissures.get((group.tier || "").toLowerCase());
    if (!fissure) continue;
    const held = bestHeld(group, counts, goal);
    if (!held) continue;
    const value = held.ev == null ? BASE_VALUE : clamp01(held.ev / VALUE_REFERENCE[goal]);
    rows.push({ group, held, fissure, value });
  }

  return rows
    .map((row) => ({ row, key: sortValue(row, relicSort) }))
    .sort(compareRelics(relicSortDir))
    .slice(0, SUGGESTION_LIMIT)
    .map((ranked) => ranked.row);
}

let cached: { keys: readonly unknown[]; drafts: SuggestionDraft[] } | null = null;

/** Everything a relic card says comes off the shelf, the live fissure table and
 *  what the market cache last quoted, so only a change to one of those can
 *  change the feed. The era boxes are keyed by the names they hold: the toggle
 *  that ticks one rebuilds the array. */
function relicKeys(ctx: SuggestionContext): readonly unknown[] {
  const { prefs } = ctx;
  const { relicGoal, relicSort, relicSortDir, relicEras } = prefs.options;
  return [
    ctx.relicDb,
    ctx.inventory,
    ctx.world,
    ctx.nowMs,
    ctx.t,
    prefs.activities,
    prefs.missionTypes,
    relicGoal,
    relicSort,
    relicSortDir,
    relicEras.join(","),
    get(priceCacheRevision),
  ];
}

function relicDrafts(ctx: SuggestionContext): SuggestionDraft[] {
  const { prefs, world, nowMs, t } = ctx;
  const activity = prefs.activities[RELICS_ACTIVITY] ?? "normal";
  if (activity === "never") return [];

  const goal = prefs.options.relicGoal;
  const fissures = fissuresByTier(prefs, world, nowMs);

  return candidates(ctx, goal, fissures).map(({ group, held, fissure, value }, order) => {
    const art = headlineReward(held.rewards, goal);
    return {
      id: `relics:${group.key}`,
      order,
      category: "relics" as const,
      title: t("nextUp.relicCrack", { relic: group.name }),
      why: [
        t("nextUp.whyRelicRefinement", {
          count: String(held.count),
          quality: t(`relics.quality.${held.quality}` as MessageKey),
        }),
        t("nextUp.whyRelicFissure", { mission: fissure.missionType, node: fissure.node }),
        payoffWhy(held.ev, goal, t),
      ].join(" - "),
      reward: art ? { name: art.name, uniqueName: art.uniqueName ?? undefined } : undefined,
      signals: {
        value,
        effort: effortFor(fissure),
        urgency: urgencyFromExpiry(fissure.expiry, nowMs) * FISSURE_URGENCY,
      },
      // The window and the refinement are what the card is about, so a
      // dismissal lifts once the fissure rotates or the goal changes.
      fingerprint: `${goal}|${held.quality}|${fissure.node}|${fissure.expiry}`,
      deprioritized: activity === "low",
      wiki: group.name,
      details: {
        pool: held.rewards.slice(0, POOL_LIMIT).map((reward) => reward.name),
        missions: [{ name: fissure.missionType, opinion: fissure.opinion }],
        expiry: fissure.expiry,
        relic: relicFacts(held, fissure),
      },
    };
  });
}

export const relicsProvider: SuggestionProvider = {
  id: "relics",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const keys = relicKeys(ctx);
    if (cached && keys.every((key, index) => cached?.keys[index] === key)) return cached.drafts;
    const drafts = relicDrafts(ctx);
    cached = { keys, drafts };
    return drafts;
  },
};
