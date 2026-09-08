import { get } from "svelte/store";

import { overframeRankingsRevision } from "../../../stores/overframeRankings.js";
import { activeWindow, nextDailyResetUtc, nextWeeklyResetUtc } from "../../format.js";
import type { MessageKey } from "../../i18n.js";
import {
  fourDayResetIso,
  trackerCount,
  trackerList,
  trackerPeriodKey,
} from "../../world/dailies.js";
import { bird3ShardColor, trackerExpiries, trackerLive } from "../../world/dailiesLive.js";
import { buildOwnership } from "../acquisition/parts.js";
import { tierOrder } from "../acquisition/recommend.js";
import { itemTiers } from "../acquisition/tiers.js";
import { resolveDropArt } from "../dropPools.js";
import { FULL_GAIN, advances, ownedGain } from "../gain.js";
import { ownedRewardFor } from "../ownedRewards.js";
import { bestWorth, rewardValue, rewardWorth } from "../rewards.js";
import { urgencyFromExpiry } from "../score.js";
import { UNPLACED_WORTH, UNRESOLVED_WORTH, bandFloor } from "../worthLadder.js";
import { setValenceRows, valenceDoc, valenceOffersFor, type ValenceOffer } from "../valence.js";
import { vendorOffers, type VendorOffer } from "../vendorOffers.js";
import { resolveRewardUniqueName } from "../../bountyRewards.js";
import type {
  RewardWorth,
  SuggestionContext,
  SuggestionDraft,
  SuggestionPreferences,
  SuggestionProvider,
  SuggestionReward,
} from "../../../types/suggest.js";
import type { ItemDbEntry } from "../../../types/inventory.js";
import type { VaultTrader, WorldState } from "../../../types/world.js";

type VendorId =
  | "baro"
  | "varzia"
  | "darvo"
  | "palladino"
  | "acrithis"
  | "bird3"
  | "yonta"
  | "tenetMelee"
  | "codaWeapons";

const VENDOR_IDS: readonly string[] = [
  "baro",
  "varzia",
  "darvo",
  "palladino",
  "acrithis",
  "bird3",
  "yonta",
  "tenetMelee",
  "codaWeapons",
];

/** The two stalls whose stock comes off the rotation table rather than world
 *  state, so an unread table is an unknown rotation and not an empty one. */
const VALENCE_VENDORS: readonly string[] = ["tenetMelee", "codaWeapons"];

/** The details view lays the stock out as one wrapping line. */
const STOCK_LIMIT = 12;

/** Bird 3 holds one Archon Shard colour a week off a three-week rotation, so
 *  the whole curated list is the rotation and only one row of it is his stock. */
const BIRD3 = "bird3";

/** What the curated table says a vendor is holding now: the whole table for a
 *  stall whose stock does not move, and this week's row where it does. */
export function liveVendorOffers(taskId: string, nowMs: number): VendorOffer[] {
  const offers = vendorOffers(taskId);
  if (taskId !== BIRD3) return offers;
  const color = bird3ShardColor(nowMs).toLowerCase();
  const held = offers.filter((offer) => offer.name.toLowerCase().startsWith(color));
  return held.length > 0 ? held : offers;
}

/** One thing a stall is holding, against what this player already has. */
interface HeldOffer {
  name: string;
  gain: number;
}

/** Mastery gear pays once, so owning it ends the reason to buy it. Resources,
 *  mods, arcanes and adapters stack, so a second is as good as the first. */
function ownershipGain(
  name: string,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): number {
  const uniqueName = resolveRewardUniqueName(name, itemDb);
  if (!uniqueName) return FULL_GAIN;
  const stacks = itemDb[uniqueName]?.masterable !== true;
  return ownedGain(ownedRewardFor({ name, uniqueName }, itemDb, ownership), stacks);
}

/** What the stall is holding: its live manifest where world state carries one,
 *  and the curated table for the vendors it does not. Null is a stall nothing
 *  named, which is unknown rather than empty. */
function heldOffers(
  stock: readonly string[],
  taskId: string,
  nowMs: number,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): HeldOffer[] | null {
  const names =
    stock.length > 0 ? stock : liveVendorOffers(taskId, nowMs).map((offer) => offer.name);
  if (names.length === 0) return null;
  return names.map((name) => ({ name, gain: ownershipGain(name, itemDb, ownership) }));
}

/** The offer a stall is worth the trip for, and how far it advances the player.
 *  The two stay apart: worth bands the card, gain only picks between offers and
 *  breaks ties inside the band. */
interface Stall {
  worth: number;
  gain: number;
}

/** A card stands for a whole stall, so it is worth the best thing on the table
 *  that this player still needs: most stalls hold one rotating slot that ever
 *  matters. Null is nothing needed, which still shows the card at zero worth. */
function bestStall(prefs: SuggestionPreferences, held: readonly HeldOffer[]): Stall | null {
  let best: Stall | null = null;
  let bestScore = 0;
  for (const offer of held) {
    if (!advances(offer.gain)) continue;
    const worth = rewardValue(prefs, offer.name) ?? UNPLACED_WORTH;
    const score = worth * offer.gain;
    if (best === null || score > bestScore) {
      best = { worth, gain: offer.gain };
      bestScore = score;
    }
  }
  return best;
}

/** A stall whose stock has not loaded is unknown, not worthless: score it off
 *  what the vendor could be holding, and settle for a floor when nothing names
 *  even that. */
function unknownStallWorth(prefs: SuggestionPreferences, taskId: string, nowMs: number): number {
  const names = liveVendorOffers(taskId, nowMs).map((offer) => offer.name);
  if (names.length === 0) return UNRESOLVED_WORTH;
  return bestWorth(prefs, names) ?? UNRESOLVED_WORTH;
}

/** Vendors whose stock is never worth pricing. Darvo discounts one arbitrary
 *  market item, and Varzia sells vaulted relics by the fistful; neither is a
 *  reason to log in, and both are only here so the trip is not forgotten, so
 *  they sit at the foot of filler rather than anywhere inside it. */
const FLAT_FILLER: readonly string[] = ["darvo", "varzia"];

function isFlatFiller(taskId: string): boolean {
  return FLAT_FILLER.includes(taskId);
}

type DailyDeal = NonNullable<WorldState["dailyDeals"]>[number];

interface Presence {
  /** End of the window the vendor is scored against. */
  expiry: string | null;
  /** The window rerolls the stall's stock rather than closing the stall, so
   *  missing it costs the player nothing: only a trader who leaves, or an
   *  allowance that goes unspent, is a deadline. */
  rerolls?: boolean;
  stock: string[];
}

function traderPresence(trader: VaultTrader | null | undefined, nowMs: number): Presence | null {
  if (!trader || !activeWindow(trader.activation, trader.expiry, nowMs)) return null;
  const stock: string[] = [];
  for (const entry of trader.inventory ?? []) {
    const name = entry.item?.trim();
    if (name && !stock.includes(name)) stock.push(name);
  }
  return { expiry: trader.expiry ?? null, stock: stock.slice(0, STOCK_LIMIT) };
}

/** Darvo's deal carries no activation, so it stands until it expires or sells out. */
function darvoPresence(deal: DailyDeal | undefined, nowMs: number): Presence | null {
  if (!deal?.item) return null;
  const expiryMs = deal.expiry ? Date.parse(deal.expiry) : NaN;
  if (Number.isFinite(expiryMs) && expiryMs <= nowMs) return null;
  const { sold, total } = deal;
  if (typeof sold === "number" && typeof total === "number" && sold >= total) return null;
  return { expiry: deal.expiry ?? null, stock: [deal.item] };
}

/** A vendor world state carries no manifest for is simply always there, so the
 *  window that matters is the reset that rerolls what they are holding. A daily
 *  or weekly reset spends an allowance with it, so an unspent one is lost; a
 *  rotation grid spends nothing, and only swaps the stall's stock. */
function curatedPresence(period: string, now: Date): Presence {
  if (period === "daily") return { expiry: nextDailyResetUtc(now).toISOString(), stock: [] };
  if (period === "weekly") return { expiry: nextWeeklyResetUtc(now).toISOString(), stock: [] };
  const rotation = fourDayResetIso(period, now);
  if (rotation === null) return { expiry: null, stock: [] };
  return { expiry: rotation, rerolls: true, stock: [] };
}

function presenceOf(
  id: VendorId,
  period: string,
  world: WorldState | null,
  now: Date,
  nowMs: number,
): Presence | null {
  if (id === "baro") return traderPresence(world?.voidTrader, nowMs);
  if (id === "varzia") return traderPresence(world?.vaultTrader, nowMs);
  if (id === "darvo") return darvoPresence(world?.dailyDeals?.[0], nowMs);
  return curatedPresence(period, now);
}

/** Vendors whose live line the card would only say a second time: the art and
 *  the tier badge already carry the shard this week is holding. */
const ART_SAYS_IT: readonly string[] = ["bird3"];

/** An unrated name sorts behind every rated one rather than ahead of "low". */
const WORTH_RANK: Record<RewardWorth, number> = { great: 0, good: 1, ok: 2, low: 3 };
const UNRATED_RANK = 4;

/** The order the stall's own stock list reads in: where the ladder places the
 *  name, then the tier letter that carries the gear it places none of. */
function stockOrder(prefs: SuggestionPreferences, name: string): [number, number] {
  const worth = rewardWorth(prefs, name);
  return [worth ? WORTH_RANK[worth] : UNRATED_RANK, tierOrder(itemTiers(name)) ?? UNRATED_RANK];
}

/** The head of the stock list that the item database can actually picture:
 *  packs and accessory sets carry no entry of their own, and the card would draw
 *  a placeholder for one. */
function stockArt(
  prefs: SuggestionPreferences,
  stock: readonly string[],
  itemDb: Record<string, ItemDbEntry>,
): SuggestionReward | undefined {
  const ordered = [...stock].sort((a, b) => {
    const left = stockOrder(prefs, a);
    const right = stockOrder(prefs, b);
    return left[0] - right[0] || left[1] - right[1] || a.localeCompare(b);
  });
  for (const name of ordered) {
    const art = resolveDropArt(itemDb, name);
    if (art?.imageUrl) return { name: art.name, imageUrl: art.imageUrl };
  }
  return undefined;
}

/** What the card pictures. The rolls are ordered by gain, so the head of them is
 *  the offer worth buying, and the art comes off that offer's own identity: a
 *  fall back to the head of the curated table pictured a different weapon from
 *  the one the field row names. A live manifest is the stall's real stock, so
 *  the best of that stands for it ahead of anything curated. */
function rewardFor(
  taskId: string,
  nowMs: number,
  roll: ValenceOffer | undefined,
  stock: readonly string[],
  prefs: SuggestionPreferences,
  itemDb: Record<string, ItemDbEntry>,
): SuggestionReward | undefined {
  if (roll) {
    return { name: roll.name, ...(roll.uniqueName ? { uniqueName: roll.uniqueName } : {}) };
  }
  const held = stock.length > 0 ? stockArt(prefs, stock, itemDb) : undefined;
  if (held) return held;
  const offer = liveVendorOffers(taskId, nowMs)[0];
  if (!offer) return undefined;
  return { name: offer.name, ...(offer.uniqueName ? { uniqueName: offer.uniqueName } : {}) };
}

let cached: { keys: readonly unknown[]; drafts: SuggestionDraft[] } | null = null;

/** A stall's card is its live manifest, the curated table read at this instant,
 *  and what the player already holds. `valenceDoc` is called on every pass
 *  whatever the cache says: the first call is what starts the fetch. */
function vendorKeys(ctx: SuggestionContext): readonly unknown[] {
  return [
    ctx.tracker,
    ctx.world,
    ctx.inventory,
    ctx.itemDb,
    ctx.nowMs,
    ctx.t,
    ctx.prefs.activities,
    ctx.prefs.worth,
    valenceDoc(),
    // Rolls carry a tier letter, and a refreshed overframe table moves them.
    get(overframeRankingsRevision),
  ];
}

function vendorDrafts(ctx: SuggestionContext): SuggestionDraft[] {
  const { tracker, world, prefs, itemDb, nowMs, t } = ctx;
  const now = new Date(nowMs);
  const expiries = trackerExpiries(world);
  const valence = valenceDoc();
  const ownership = buildOwnership(ctx.inventory, itemDb);
  const drafts: SuggestionDraft[] = [];

  for (const task of trackerList(tracker)) {
    if (!VENDOR_IDS.includes(task.id)) continue;
    if (tracker.hidden.includes(task.id)) continue;
    const activity = prefs.activities[task.id] ?? "normal";
    if (activity === "never") continue;

    const here = presenceOf(task.id as VendorId, task.period, world, now, nowMs);
    if (!here) continue;

    const periodKey = trackerPeriodKey(task.period, now, expiries);
    const done = trackerCount(tracker, task.id, periodKey, nowMs);
    if (done >= task.target) continue;

    const live = trackerLive(task.id, world, t, nowMs);
    const rolls = valenceOffersFor(valence, task.id, nowMs, ctx.inventory, ctx.itemDb);
    const best = rewardFor(task.id, nowMs, rolls[0], here.stock, prefs, itemDb);
    // A vendor who is away has no card at all, so no card says a vendor is here.
    const detail = ART_SAYS_IT.includes(task.id) ? null : (live.detail ?? null);
    const id = `vendors:${task.id}`;
    setValenceRows(id, rolls);

    const held = VALENCE_VENDORS.includes(task.id)
      ? rolls.length > 0
        ? rolls.map((roll) => ({ name: roll.name, gain: roll.gain }))
        : null
      : heldOffers(here.stock, task.id, nowMs, itemDb, ownership);
    const stall = held === null ? null : bestStall(prefs, held);

    drafts.push({
      id,
      category: "vendor",
      title: task.label ?? t(`dailies.task.${task.id}` as MessageKey),
      why: detail ?? "",
      reward: best,
      ...(rolls[0]?.tier ? { tier: rolls[0].tier } : {}),
      signals: {
        value: isFlatFiller(task.id)
          ? bandFloor("filler")
          : held === null
            ? unknownStallWorth(prefs, task.id, nowMs)
            : (stall?.worth ?? UNPLACED_WORTH),
        // A vendor trip is near-free once the currency is banked, and effort
        // orders nothing regardless.
        effort: 0,
        urgency: urgencyFromExpiry(here.expiry, nowMs),
        // Nothing on the table needing buying leaves the card at zero worth
        // rather than dropping it, so the trip is not forgotten.
        ...(stall ? { gain: stall.gain } : {}),
      },
      // Baro keys off the visit's activation, Darvo off the deal's expiry, so
      // a dismissal lifts as soon as the vendor rotates.
      fingerprint: periodKey ?? `${task.id}:${here.expiry ?? ""}`,
      deprioritized: activity === "low",
      complete: { taskId: task.id, periodKey, count: done, target: task.target },
      wiki: task.wiki,
      details: {
        pool: here.stock.length > 0 ? here.stock : undefined,
        expiry: here.expiry,
        ...(here.rerolls === true ? { rerolls: true } : {}),
      },
    });
  }

  return drafts;
}

export const vendorsProvider: SuggestionProvider = {
  id: "vendors",

  // The valence rows the cards read back are parked in `valence.ts` during the
  // collect below. Nothing else writes that table, so a hit leaves exactly the
  // rows an identical pass already put there.
  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const keys = vendorKeys(ctx);
    if (cached && keys.every((key, index) => cached?.keys[index] === key)) return cached.drafts;
    const drafts = vendorDrafts(ctx);
    cached = { keys, drafts };
    return drafts;
  },
};
