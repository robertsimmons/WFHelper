import { get } from "svelte/store";

import { priceCacheRevision } from "../../../stores/pricing.js";
import { QUALITY_MODES } from "../../relic/relicConstants.js";
import { parseOwnedRelics } from "../../relic/relicInventory.js";
import { computeSquadEV } from "../../relic/relicMath.js";
import { getCachedPriceState } from "../../wfm/priceCache.js";
import { buildOwnership } from "../acquisition/parts.js";
import { missionOpinion } from "../missionTypes.js";
import { rewardWorth } from "../rewards.js";
import { clamp01, urgencyFromExpiry } from "../score.js";
import { resolveRewardUniqueName } from "../../bountyRewards.js";
import { pendingBuildCounts } from "../../../../config/shared/foundryPending.js";
import { normalizeDucats } from "../../../../config/shared/numeric.js";
import {
  masteredKeys,
  relicAdvice,
  relicMr,
  relicRarity,
  type RelicAdvice,
  type RelicMr,
  type RelicRarity,
  type RelicRewardMr,
} from "../../../../config/shared/relicMr.js";
import { rendererPriceCacheKey } from "../../../../config/shared/wfmCacheKeys.js";
import { RELIC_ERAS } from "../../../types/suggest.js";
import type { MessageKey } from "../../i18n.js";
import type { SortDirection } from "../../../types/filters.js";
import type {
  MissionOpinion,
  RelicEra,
  RelicFacts,
  RelicGoal,
  RelicMission,
  SuggestionContext,
  SuggestionDraft,
  SuggestionPoolRow,
  SuggestionPreferences,
  SuggestionProvider,
  SuggestionReward,
} from "../../../types/suggest.js";
import type { ItemDbEntry } from "../../../types/inventory.js";
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

const BEST_FIRST: readonly RelicQuality[] = [...QUALITY_MODES].reverse();

/** Which grade to reach for first, best held or cheapest held. MR reaches for
 *  the advised grade and falls back on this. */
const REFINEMENT_ORDER: Record<RelicGoal, readonly RelicQuality[]> = {
  mr: BEST_FIRST,
  platinum: BEST_FIRST,
  ducats: QUALITY_MODES,
};

/** A run worth this much is as good as this feed gets. On MR that is two needed
 *  parts, one of them finishing its item. */
const VALUE_REFERENCE: Record<RelicGoal, number> = { mr: 3, platinum: 40, ducats: 60 };

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

const RARITY_RANK: Record<RelicRarity, number> = { common: 0, uncommon: 1, rare: 2 };

function opinionRank(opinion: MissionOpinion | null): number {
  if (opinion === "good") return 0;
  return opinion === "bad" ? 2 : 1;
}

/** The mission the player would rather run, and among equals the one with the
 *  most time left on it. */
function compareMissions(a: RelicMission, b: RelicMission): number {
  return (
    opinionRank(a.opinion) - opinionRank(b.opinion) || Date.parse(b.expiry) - Date.parse(a.expiry)
  );
}

/** Live fissures per tier, best first. A Void Storm is a Railjack run, not this. */
function fissuresByTier(
  prefs: SuggestionPreferences,
  world: WorldState | null,
  nowMs: number,
): Map<string, RelicMission[]> {
  const byTier = new Map<string, RelicMission[]>();
  for (const fissure of world?.fissures ?? []) {
    if (fissure.expired || fissure.isStorm) continue;
    const expiryMs = fissure.expiry ? Date.parse(fissure.expiry) : NaN;
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) continue;
    const tier = (fissure.tier ?? "").toLowerCase();
    const missionType = fissure.missionType ?? "";
    if (!tier || !missionType) continue;
    byTier.set(tier, [
      ...(byTier.get(tier) ?? []),
      {
        missionType,
        node: fissure.node ?? "",
        isHard: fissure.isHard === true,
        opinion: missionOpinion(prefs, missionType),
        expiry: fissure.expiry as string,
      },
    ]);
  }
  for (const missions of byTier.values()) missions.sort(compareMissions);
  return byTier;
}

function platPrice(reward: RelicReward): number | null {
  if (!reward.urlName) return null;
  const entry = getCachedPriceState(rendererPriceCacheKey(reward.urlName, null));
  return entry?.status === "ok" ? entry.median : null;
}

type PayoutGoal = Exclude<RelicGoal, "mr">;

function rewardValue(reward: RelicReward, goal: PayoutGoal): number | null {
  return goal === "ducats" ? normalizeDucats(reward.ducats) : platPrice(reward);
}

/** Solo EV of one crack, on the same maths the Relics tab orders by. */
function expectedValue(rewards: RelicReward[], goal: PayoutGoal): number | null {
  const values = rewards.map((reward) => rewardValue(reward, goal));
  if (!values.some((value) => value != null)) return null;
  return computeSquadEV(rewards, values, 1);
}

interface Held {
  quality: RelicQuality;
  count: number;
  rewards: RelicReward[];
  /** On the goal's payout; MR has none, so it carries platinum. */
  ev: number | null;
}

/** The refinement to run. A platinum goal wants the best grade held, because
 *  the rare is the payday; a ducat run takes the cheapest, because traces spent
 *  on ducat fodder never come back; MR takes the grade its needed part calls
 *  for, and the best held otherwise. */
function bestHeld(
  group: RelicGroup,
  counts: OwnedQualityCounts | undefined,
  goal: RelicGoal,
  advice: RelicAdvice,
): Held | null {
  const advised = goal === "mr" ? advice.mr : null;
  const order = advised
    ? [advised, ...REFINEMENT_ORDER[goal].filter((quality) => quality !== advised)]
    : REFINEMENT_ORDER[goal];
  const payout: PayoutGoal = goal === "mr" ? "platinum" : goal;
  for (const quality of order) {
    const count = counts?.[quality] ?? 0;
    if (count <= 0) continue;
    const rewards = group.qualities[quality]?.rewards ?? [];
    if (rewards.length === 0) continue;
    return { quality, count, rewards, ev: expectedValue(rewards, payout) };
  }
  return null;
}

interface MrInputs {
  ownership: Map<string, number>;
  pending: Map<string, number>;
  mastered: Set<string>;
}

/** One ownership read per inventory, item database and roster: every toggle
 *  would walk the whole inventory again otherwise. */
let mrInputsCache: {
  inventory: SuggestionContext["inventory"];
  itemDb: SuggestionContext["itemDb"];
  mastery: SuggestionContext["mastery"];
  inputs: MrInputs;
} | null = null;

function mrInputs(ctx: SuggestionContext): MrInputs {
  const { inventory, itemDb, mastery } = ctx;
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
function rewardUniqueName(
  reward: RelicReward,
  itemDb: Record<string, ItemDbEntry>,
): string | undefined {
  return resolveRewardUniqueName(reward.name, itemDb) ?? reward.uniqueName ?? undefined;
}

/** Every refinement names the same drops, so any one table answers for them. */
function referenceTable(
  group: RelicGroup,
): { quality: RelicQuality; rewards: RelicReward[] } | null {
  for (const quality of QUALITY_MODES) {
    const rewards = group.qualities[quality]?.rewards ?? [];
    if (rewards.length > 0) return { quality, rewards };
  }
  return null;
}

interface GroupRead {
  mr: RelicMr;
  byName: Map<string, RelicRewardMr>;
  advice: RelicAdvice;
}

function readGroup(group: RelicGroup, ctx: SuggestionContext, inputs: MrInputs): GroupRead | null {
  const table = referenceTable(group);
  if (!table) return null;
  const mr = relicMr({
    rewards: table.rewards.map((reward) => ({
      name: reward.name,
      uniqueName: rewardUniqueName(reward, ctx.itemDb),
    })),
    itemDb: ctx.itemDb,
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

function rarityRank(quality: RelicQuality, reward: RelicReward): number {
  const rarity = relicRarity(quality, reward);
  return rarity ? RARITY_RANK[rarity] : -1;
}

/** The part MR is chasing: one that finishes its item first, then the rarest. */
function neededHeadline(held: Held, read: GroupRead): RelicReward | null {
  let best: RelicReward | null = null;
  for (const reward of held.rewards) {
    const row = read.byName.get(reward.name);
    if (row?.status !== "needed") continue;
    if (!best) {
      best = reward;
      continue;
    }
    const finishes = Number(row.finishes) - Number(read.byName.get(best.name)?.finishes ?? false);
    const rarer = rarityRank(held.quality, reward) - rarityRank(held.quality, best);
    const pricier = (platPrice(reward) ?? -1) - (platPrice(best) ?? -1);
    if ((finishes || rarer || pricier) > 0) best = reward;
  }
  return best;
}

/** What the card pictures: the drop the goal is actually chasing. */
function headlineReward(held: Held, goal: RelicGoal, read: GroupRead): RelicReward | null {
  if (goal === "mr") {
    const needed = neededHeadline(held, read);
    if (needed) return needed;
  }
  const payout: PayoutGoal = goal === "mr" ? "platinum" : goal;
  let best: RelicReward | null = null;
  let bestValue = -Infinity;
  for (const reward of held.rewards) {
    const value = rewardValue(reward, payout);
    if (value != null && value > bestValue) {
      best = reward;
      bestValue = value;
    }
  }
  if (best) return best;
  // Nothing priced, so fall back to what a relic is remembered by.
  return held.rewards.reduce<RelicReward | null>(
    (rarest, reward) => (!rarest || reward.chance < rarest.chance ? reward : rarest),
    null,
  );
}

/** The part the goal is chasing, in the shape a card can picture. The table's
 *  own mirrored icon is the art of last resort. */
function partReward(
  reward: RelicReward,
  quality: RelicQuality,
  itemDb: Record<string, ItemDbEntry>,
): SuggestionReward {
  return {
    name: reward.name,
    uniqueName: rewardUniqueName(reward, itemDb),
    ...(reward.imageUrl ? { imageUrl: reward.imageUrl } : {}),
    platinum: platPrice(reward),
    ducats: normalizeDucats(reward.ducats),
    rarity: relicRarity(quality, reward),
  };
}

/** Everything one crack pays, rated where the ladder places it and carrying the
 *  chance the relic table gives it, so a card can name the notable drops on the
 *  same footing a drop pool is named on. Read through `rewardWorth`, which logs
 *  no coverage gap: listing a drop is not a claim that the app rates it. */
function poolRows(
  prefs: SuggestionPreferences,
  held: Held,
  itemDb: Record<string, ItemDbEntry>,
  read: GroupRead,
): SuggestionPoolRow[] {
  return held.rewards.map((reward) => {
    const mr = read.byName.get(reward.name);
    return {
      name: reward.name,
      // The same join and the same last resort the card's own art goes through, so
      // a tile and the picture above it can never disagree.
      uniqueName: rewardUniqueName(reward, itemDb),
      ...(reward.imageUrl ? { imageUrl: reward.imageUrl } : {}),
      chance: reward.chance,
      worth: rewardWorth(prefs, reward.name) ?? undefined,
      rarity: relicRarity(held.quality, reward),
      platinum: platPrice(reward),
      ducats: normalizeDucats(reward.ducats),
      status: mr?.status ?? null,
      ownedCount: mr?.ownedCount ?? null,
    };
  });
}

/** Both payouts, whichever goal the player picked: the card compares them. */
function relicFacts(
  held: Held,
  missions: RelicMission[],
  read: GroupRead,
  payoff: string | null,
): RelicFacts {
  return {
    count: held.count,
    quality: held.quality,
    node: missions[0]?.node ?? "",
    platinum: expectedValue(held.rewards, "platinum"),
    ducats: expectedValue(held.rewards, "ducats"),
    advice: read.advice,
    payoff,
    mr: { needed: read.mr.needed, finishes: read.mr.finishes, value: read.mr.value },
    missions,
  };
}

function effortFor(fissure: RelicMission): number {
  const mission =
    fissure.opinion === "bad"
      ? SLOW_MISSION_EFFORT
      : fissure.opinion === "good"
        ? -FAST_MISSION_RELIEF
        : 0;
  return clamp01(BASE_EFFORT + mission + (fissure.isHard ? STEEL_PATH_EFFORT : 0));
}

/** Null where the goal pays nothing the tables can price. */
function payoffWhy(
  held: Held,
  goal: RelicGoal,
  mr: RelicMr,
  t: SuggestionContext["t"],
): string | null {
  if (goal === "mr") {
    const count = String(mr.needed);
    return mr.finishes.length > 0
      ? t("nextUp.whyRelicMrFinishes", { count, item: mr.finishes.join(", ") })
      : t("nextUp.whyRelicMr", { count });
  }
  if (held.ev == null) return null;
  const value = String(Math.round(held.ev));
  return t(goal === "ducats" ? "nextUp.whyRelicDucats" : "nextUp.whyRelicPlat", { value });
}

interface Candidate {
  group: RelicGroup;
  held: Held;
  missions: RelicMission[];
  read: GroupRead;
  value: number;
}

const matches = (era: RelicEra, tier: string): boolean => era.toLowerCase() === tier;

/** Vanguard relics reach the database with no box of their own, and a tier the
 *  boxes cannot name is not a tier they narrow. */
function inEras(eras: readonly RelicEra[], tier: string): boolean {
  const wanted = tier.toLowerCase();
  if (!RELIC_ERAS.some((era) => matches(era, wanted))) return true;
  return eras.some((era) => matches(era, wanted));
}

const negate = (value: number | null): number | null => (value == null ? null : -value);

/** Lower sorts earlier: the order is a position, so ascending is the best of
 *  it. Null is unpriced, and sorts last whichever way the arrow points. Later
 *  keys only break ties in earlier ones. */
function sortKeys(row: Candidate, goal: RelicGoal): (number | null)[] {
  const mission = opinionRank(row.missions[0]?.opinion ?? null);
  if (goal !== "mr") return [mission, -row.value];
  return [-row.read.mr.value, mission, negate(expectedValue(row.held.rewards, "platinum"))];
}

interface Ranked {
  row: Candidate;
  /** Read once per row: the comparator asks O(n log n) times and every answer
   *  is another squad-EV pass over the reward table. */
  keys: (number | null)[];
}

function compareRelics(direction: SortDirection): (a: Ranked, b: Ranked) => number {
  const flip = direction === "desc" ? -1 : 1;
  return (a, b) => {
    for (let index = 0; index < a.keys.length; index += 1) {
      const left = a.keys[index] ?? null;
      const right = b.keys[index] ?? null;
      if (left === null || right === null) {
        if (left !== right) return left === null ? 1 : -1;
      } else if (left !== right) {
        return (left - right) * flip;
      }
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

function goalValue(goal: RelicGoal, held: Held, read: GroupRead): number {
  if (goal === "mr") return clamp01(read.mr.value / VALUE_REFERENCE.mr);
  return held.ev == null ? BASE_VALUE : clamp01(held.ev / VALUE_REFERENCE[goal]);
}

function candidates(
  ctx: SuggestionContext,
  goal: RelicGoal,
  fissures: Map<string, RelicMission[]>,
): Candidate[] {
  const db = ctx.relicDb;
  if (!db || fissures.size === 0) return [];
  const { relicEras, relicSortDir } = ctx.prefs.options;
  const owned = ownedRelics(ctx.inventory, db);
  const inputs = mrInputs(ctx);
  const rows: Candidate[] = [];

  for (const [groupKey, counts] of Object.entries(owned)) {
    const group = db.groups[groupKey];
    if (!group) continue;
    if (!inEras(relicEras, group.tier || "")) continue;
    const missions = fissures.get((group.tier || "").toLowerCase());
    if (!missions?.length) continue;
    const read = readGroup(group, ctx, inputs);
    if (!read) continue;
    if (goal === "mr" && read.mr.value <= 0) continue;
    const held = bestHeld(group, counts, goal, read.advice);
    if (!held) continue;
    rows.push({ group, held, missions, read, value: goalValue(goal, held, read) });
  }

  return rows
    .map((row) => ({ row, keys: sortKeys(row, goal) }))
    .sort(compareRelics(relicSortDir))
    .slice(0, SUGGESTION_LIMIT)
    .map((ranked) => ranked.row);
}

let cached: { keys: readonly unknown[]; drafts: SuggestionDraft[] } | null = null;

/** Everything a relic card says comes off the shelf, the live fissure table,
 *  the mastery roster and what the market cache last quoted, so only a change
 *  to one of those can change the feed. The era boxes are keyed by the names
 *  they hold: the toggle that ticks one rebuilds the array. */
function relicKeys(ctx: SuggestionContext): readonly unknown[] {
  const { prefs } = ctx;
  const { relicGoal, relicSortDir, relicEras } = prefs.options;
  return [
    ctx.relicDb,
    ctx.inventory,
    // The part a card pictures is joined by name against the item database, and
    // the drops it lists are rated off the ladder.
    ctx.itemDb,
    ctx.mastery,
    ctx.world,
    ctx.nowMs,
    ctx.t,
    prefs.activities,
    prefs.missionTypes,
    prefs.worth,
    relicGoal,
    relicSortDir,
    relicEras.join(","),
    get(priceCacheRevision),
  ];
}

type MissionRow = NonNullable<NonNullable<SuggestionDraft["details"]>["missions"]>[number];

/** Every mission type the tier is open on, best first, for the colour-coded row. */
function missionTypes(missions: readonly RelicMission[]): MissionRow[] {
  const seen = new Set<string>();
  const out: MissionRow[] = [];
  for (const mission of missions) {
    if (seen.has(mission.missionType)) continue;
    seen.add(mission.missionType);
    out.push({ name: mission.missionType, opinion: mission.opinion });
  }
  return out;
}

function relicDrafts(ctx: SuggestionContext): SuggestionDraft[] {
  const { prefs, world, nowMs, t } = ctx;
  const activity = prefs.activities[RELICS_ACTIVITY] ?? "normal";
  if (activity === "never") return [];

  const goal = prefs.options.relicGoal;
  const fissures = fissuresByTier(prefs, world, nowMs);

  return candidates(ctx, goal, fissures).map(({ group, held, missions, read, value }, order) => {
    const fissure = missions[0] as RelicMission;
    const art = headlineReward(held, goal, read);
    const payoff = payoffWhy(held, goal, read.mr, t);
    return {
      id: `relics:${group.key}`,
      order,
      category: "relics" as const,
      title: t(fissure.isHard ? "nextUp.relicTitleSp" : "nextUp.relicTitleNormal", {
        relic: group.name,
      }),
      why: [
        t("nextUp.whyRelicRefinement", {
          count: String(held.count),
          quality: t(`relics.quality.${held.quality}` as MessageKey),
        }),
        t("nextUp.whyRelicFissure", { mission: fissure.missionType, node: fissure.node }),
        ...(payoff ? [payoff] : []),
      ].join(" - "),
      reward: art ? partReward(art, held.quality, ctx.itemDb) : undefined,
      signals: {
        value,
        effort: effortFor(fissure),
        urgency: urgencyFromExpiry(fissure.expiry, nowMs) * FISSURE_URGENCY,
      },
      // The window and the refinement are what the card is about, so a
      // dismissal lifts once the fissure rotates or the goal changes; on MR a
      // part landing changes it too.
      fingerprint: [
        goal,
        held.quality,
        fissure.node,
        fissure.expiry,
        ...(goal === "mr" ? [read.mr.needed] : []),
      ].join("|"),
      deprioritized: activity === "low",
      wiki: group.name,
      details: {
        pool: poolRows(prefs, held, ctx.itemDb, read),
        missions: missionTypes(missions),
        expiry: fissure.expiry,
        relic: relicFacts(held, missions, read, payoff),
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
