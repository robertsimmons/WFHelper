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
import { FULL_GAIN, advances, ownedGain } from "../gain.js";
import { ownedRewardFor } from "../ownedRewards.js";
import { bestWorth, rewardValue } from "../rewards.js";
import { urgencyFromExpiry } from "../score.js";
import { UNPLACED_WORTH, UNRESOLVED_WORTH, bandFloor } from "../worthLadder.js";
import {
  bestValenceOffer,
  setValenceRows,
  valenceDoc,
  valenceOffersFor,
  type ValenceOffer,
  type ValenceVerdict,
} from "../valence.js";
import { vendorOffers, type VendorOffer } from "../vendorOffers.js";
import { resolveRewardUniqueName } from "../../bountyRewards.js";
import type {
  SuggestionContext,
  SuggestionDraft,
  SuggestionPreferences,
  SuggestionProvider,
  WhySegment,
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
 *  window that matters is the reset that rerolls what they are holding. */
function curatedPresence(period: string, now: Date): Presence {
  if (period === "daily") return { expiry: nextDailyResetUtc(now).toISOString(), stock: [] };
  if (period === "weekly") return { expiry: nextWeeklyResetUtc(now).toISOString(), stock: [] };
  return { expiry: fourDayResetIso(period, now), stock: [] };
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

const WHY_KEY: Record<ValenceVerdict, MessageKey> = {
  done: "nextUp.whyValenceNothing",
  secondCopy: "nextUp.whyValenceSecondCopy",
  caps: "nextUp.whyValenceCaps",
  ready: "nextUp.whyValenceReady",
  short: "nextUp.whyValence",
};

/** Only an offer that puts the cap in reach is worth the trip on its own. */
const WORTH_THE_TRIP: readonly ValenceVerdict[] = ["caps", "ready"];

/** The wiki always reports one decimal place, so a whole number reads as one. */
function rollFields(roll: ValenceOffer): Record<string, string> {
  return {
    name: roll.displayName ?? roll.name,
    element: roll.element,
    bonus: roll.bonus.toFixed(1),
    owned: roll.owned === null ? "" : roll.owned.toFixed(1),
    result: roll.result.toFixed(1),
  };
}

function whySegments(
  presence: string,
  rolls: readonly ValenceOffer[],
  t: SuggestionContext["t"],
): WhySegment[] {
  const segments: WhySegment[] = [{ text: presence }];
  const roll = rolls[0];
  if (!roll) return segments;
  // Every weapon on the table is already finished, so the rotation itself is
  // the only reason left to look.
  if (!bestValenceOffer(rolls)) {
    segments.push({ text: t(WHY_KEY.done) });
    return segments;
  }
  const text = t(WHY_KEY[roll.verdict], rollFields(roll));
  segments.push(WORTH_THE_TRIP.includes(roll.verdict) ? { text, tone: "good" } : { text });
  return segments;
}

function valencePool(rolls: readonly ValenceOffer[], t: SuggestionContext["t"]): string[] {
  return rolls.slice(0, STOCK_LIMIT).map((roll) => t("nextUp.valenceOffer", rollFields(roll)));
}

/** The weapon actually worth buying this rotation, where the curated table can
 *  name it; art and ownership both hang off the curated unique name. */
function rewardFor(
  taskId: string,
  nowMs: number,
  roll: ValenceOffer | undefined,
): VendorOffer | undefined {
  const offers = liveVendorOffers(taskId, nowMs);
  if (!roll) return offers[0];
  const needle = roll.name.toLowerCase();
  return offers.find((offer) => offer.name.toLowerCase() === needle) ?? offers[0];
}

export const vendorsProvider: SuggestionProvider = {
  id: "vendors",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
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
      const best = rewardFor(task.id, nowMs, rolls[0]);
      const segments = whySegments(live.detail ?? t("nextUp.whyVendorHere"), rolls, t);
      const pool = here.stock.length > 0 ? here.stock : valencePool(rolls, t);
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
        why: segments.map((segment) => segment.text).join(", "),
        whySegments: segments.length > 1 ? segments : undefined,
        reward: best ? { name: best.name, uniqueName: best.uniqueName } : undefined,
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
          pool: pool.length > 0 ? pool : undefined,
          expiry: here.expiry,
        },
      });
    }

    return drafts;
  },
};
