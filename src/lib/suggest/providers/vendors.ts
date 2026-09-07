import { activeWindow, nextDailyResetUtc, nextWeeklyResetUtc } from "../../format.js";
import type { MessageKey } from "../../i18n.js";
import {
  fourDayResetIso,
  trackerCount,
  trackerList,
  trackerPeriodKey,
} from "../../world/dailies.js";
import { trackerExpiries, trackerLive } from "../../world/dailiesLive.js";
import { urgencyFromExpiry } from "../score.js";
import {
  valenceDoc,
  valenceOffers,
  valenceValueFloor,
  type ValenceOffer,
  type ValenceTier,
} from "../valence.js";
import { vendorOffers, type VendorOffer } from "../vendorOffers.js";
import type {
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
  WhySegment,
} from "../../../types/suggest.js";
import type { VaultTrader, WorldState } from "../../../types/world.js";

type VendorId =
  | "baro"
  | "darvo"
  | "palladino"
  | "acrithis"
  | "bird3"
  | "yonta"
  | "tenetMelee"
  | "codaWeapons";

const VENDOR_IDS: readonly string[] = [
  "baro",
  "darvo",
  "palladino",
  "acrithis",
  "bird3",
  "yonta",
  "tenetMelee",
  "codaWeapons",
];

/** Baro's stop is the rarer of the two travellers; Darvo's deal comes round
 *  every day. The standing vendors are worth a trip once their rotation turns. */
const VALUE: Record<VendorId, number> = {
  baro: 0.7,
  darvo: 0.35,
  palladino: 0.5,
  acrithis: 0.5,
  bird3: 0.55,
  yonta: 0.4,
  tenetMelee: 0.45,
  codaWeapons: 0.45,
};

/** Ducats are farmed; Darvo's discount is still platinum out of pocket. The rest
 *  are priced in currencies that take a run of their own to earn. */
const EFFORT: Record<VendorId, number> = {
  baro: 0.2,
  darvo: 0.3,
  palladino: 0.5,
  acrithis: 0.5,
  bird3: 0.4,
  yonta: 0.5,
  tenetMelee: 0.7,
  codaWeapons: 0.7,
};

/** The details view lays the stock out as one wrapping line. */
const STOCK_LIMIT = 12;

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
  if (id === "darvo") return darvoPresence(world?.dailyDeals?.[0], nowMs);
  return curatedPresence(period, now);
}

const WHY_KEY: Record<ValenceTier, MessageKey> = {
  capped: "nextUp.whyValenceCapped",
  oneAway: "nextUp.whyValenceOneAway",
  twoAway: "nextUp.whyValenceTwoAway",
  ordinary: "nextUp.whyValence",
};

/** The wiki always reports one decimal place, so a whole number reads as one. */
function rollFields(roll: ValenceOffer): Record<string, string> {
  return { name: roll.name, element: roll.element, bonus: roll.bonus.toFixed(1) };
}

function whySegments(
  presence: string,
  roll: ValenceOffer | undefined,
  t: SuggestionContext["t"],
): WhySegment[] {
  const segments: WhySegment[] = [{ text: presence }];
  if (!roll) return segments;
  const text = t(WHY_KEY[roll.tier], rollFields(roll));
  const worthIt = roll.tier === "capped" || roll.tier === "oneAway";
  segments.push(worthIt ? { text, tone: "good" } : { text });
  return segments;
}

function valencePool(rolls: readonly ValenceOffer[], t: SuggestionContext["t"]): string[] {
  return rolls.slice(0, STOCK_LIMIT).map((roll) => t("nextUp.valenceOffer", rollFields(roll)));
}

/** The weapon actually worth buying this rotation, where the curated table can
 *  name it; art and ownership both hang off the curated unique name. */
function rewardFor(taskId: string, roll: ValenceOffer | undefined): VendorOffer | undefined {
  const offers = vendorOffers(taskId);
  if (!roll) return offers[0];
  const needle = roll.name.toLowerCase();
  return offers.find((offer) => offer.name.toLowerCase() === needle) ?? offers[0];
}

export const vendorsProvider: SuggestionProvider = {
  id: "vendors",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const { tracker, world, prefs, nowMs, t } = ctx;
    const now = new Date(nowMs);
    const expiries = trackerExpiries(world);
    const valence = valenceDoc();
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
      const rolls = valenceOffers(valence, task.id, nowMs);
      const best = rewardFor(task.id, rolls[0]);
      const segments = whySegments(live.detail ?? t("nextUp.whyVendorHere"), rolls[0], t);
      const pool = here.stock.length > 0 ? here.stock : valencePool(rolls, t);

      drafts.push({
        id: `vendors:${task.id}`,
        category: "vendor",
        title: task.label ?? t(`dailies.task.${task.id}` as MessageKey),
        why: segments.map((segment) => segment.text).join(", "),
        whySegments: segments.length > 1 ? segments : undefined,
        reward: best ? { name: best.name, uniqueName: best.uniqueName } : undefined,
        signals: {
          value: Math.max(
            VALUE[task.id as VendorId],
            rolls[0] ? valenceValueFloor(rolls[0].tier) : 0,
          ),
          effort: EFFORT[task.id as VendorId],
          urgency: urgencyFromExpiry(here.expiry, nowMs),
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
