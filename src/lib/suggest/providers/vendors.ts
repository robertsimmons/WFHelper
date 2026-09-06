import { activeWindow } from "../../format.js";
import type { MessageKey } from "../../i18n.js";
import { trackerCount, trackerList, trackerPeriodKey } from "../../world/dailies.js";
import { trackerExpiries, trackerLive } from "../../world/dailiesLive.js";
import { urgencyFromExpiry } from "../score.js";
import type {
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
} from "../../../types/suggest.js";
import type { VaultTrader, WorldState } from "../../../types/world.js";

type VendorId = "baro" | "varzia" | "darvo";

const VENDOR_IDS: readonly string[] = ["baro", "varzia", "darvo"];

/** Baro's stop is the rarest of the three; Darvo's deal comes round every day. */
const VALUE: Record<VendorId, number> = { baro: 0.7, varzia: 0.55, darvo: 0.35 };

/** Ducats and Aya are farmed; Darvo's discount is still platinum out of pocket. */
const EFFORT: Record<VendorId, number> = { baro: 0.2, varzia: 0.2, darvo: 0.3 };

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

function presenceOf(id: VendorId, world: WorldState | null, nowMs: number): Presence | null {
  if (id === "baro") return traderPresence(world?.voidTrader, nowMs);
  if (id === "varzia") return traderPresence(world?.vaultTrader, nowMs);
  return darvoPresence(world?.dailyDeals?.[0], nowMs);
}

export const vendorsProvider: SuggestionProvider = {
  id: "vendors",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const { tracker, world, prefs, nowMs, t } = ctx;
    const now = new Date(nowMs);
    const expiries = trackerExpiries(world);
    const drafts: SuggestionDraft[] = [];

    for (const task of trackerList(tracker)) {
      if (!VENDOR_IDS.includes(task.id)) continue;
      if (tracker.hidden.includes(task.id)) continue;
      const activity = prefs.activities[task.id] ?? "normal";
      if (activity === "never") continue;

      const here = presenceOf(task.id as VendorId, world, nowMs);
      if (!here) continue;

      const periodKey = trackerPeriodKey(task.period, now, expiries);
      const done = trackerCount(tracker, task.id, periodKey, nowMs);
      if (done >= task.target) continue;

      const live = trackerLive(task.id, world, t, nowMs);

      drafts.push({
        id: `vendors:${task.id}`,
        category: "vendor",
        title: task.label ?? t(`dailies.task.${task.id}` as MessageKey),
        why: live.detail ?? t("nextUp.whyVendorHere"),
        signals: {
          value: VALUE[task.id as VendorId],
          effort: EFFORT[task.id as VendorId],
          urgency: urgencyFromExpiry(here.expiry, nowMs),
        },
        // Baro and Varzia key off the visit's activation, Darvo off the deal's
        // expiry, so a dismissal lifts as soon as the vendor rotates.
        fingerprint: periodKey ?? `${task.id}:${here.expiry ?? ""}`,
        deprioritized: activity === "low",
        complete: { taskId: task.id, periodKey, count: done, target: task.target },
        wiki: task.wiki,
        details: {
          pool: here.stock.length > 0 ? here.stock : undefined,
          expiry: here.expiry,
        },
      });
    }

    return drafts;
  },
};
