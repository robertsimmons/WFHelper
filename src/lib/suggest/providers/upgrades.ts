import { get } from "svelte/store";

import { priceCacheRevision } from "../../../stores/pricing.js";
import type { UpgradeCard, UpgradeCatalog } from "../upgrades.js";
import { cardMatchesVendors } from "../upgradeVendorFilters.js";
import type {
  SuggestionContext,
  SuggestionDraft,
  SuggestionOptions,
  SuggestionProvider,
} from "../../../types/suggest.js";

/** Deep enough that the pager runs out only when the list does. Unmeasured:
 *  a lift needs a perf run behind it. */
const SUGGESTION_LIMIT = 40;

const VENDOR_OPTION = { modSearch: "modVendors", arcaneSearch: "arcaneVendors" } as const;

function matches(needle: string, card: UpgradeCard): boolean {
  return (
    card.name.toLowerCase().includes(needle) ||
    (card.displayName ?? "").toLowerCase().includes(needle)
  );
}

function draftFor(card: UpgradeCard, order: number, deprioritized: boolean): SuggestionDraft {
  const held = card.copies ? `|${card.copies.held}` : "";
  return {
    id: `${card.kind}:${card.name}`,
    order,
    category: card.kind,
    title: card.displayName ?? card.name,
    why: "",
    reward: { name: card.name, uniqueName: card.uniqueName ?? undefined },
    signals: { value: 1, effort: 0, urgency: 0, gain: 1 },
    // Owning it, or another copy of it, is the only change that makes a
    // dismissed card worth showing again.
    fingerprint: `${card.name}|${card.owned ? "owned" : "missing"}${held}`,
    deprioritized,
    wiki: card.name,
    details: { upgrade: card },
  };
}

/** One band per kind, each answering to one activity setting and one search box. */
export function createUpgradeProvider(
  catalog: UpgradeCatalog,
  activityId: string,
  searchOption: "modSearch" | "arcaneSearch",
): SuggestionProvider {
  let cached: { keys: readonly unknown[]; drafts: SuggestionDraft[] } | null = null;
  return {
    id: catalog.kind,

    collect(ctx: SuggestionContext): SuggestionDraft[] {
      const { prefs } = ctx;
      const activity = prefs.activities[activityId] ?? "normal";
      if (activity === "never") return [];
      const entries = catalog.entries(ctx.itemDb);
      if (entries.length === 0) return [];
      const options: SuggestionOptions = prefs.options;
      const needle = options[searchOption].trim().toLowerCase();
      const vendors = options[VENDOR_OPTION[searchOption]];

      // The feed re-derives on a timer; only these can change what comes back.
      const keys = [
        ctx.itemDb,
        ctx.inventory,
        needle,
        vendors.join("|"),
        activity,
        get(priceCacheRevision),
      ] as const;
      if (cached && keys.every((key, index) => cached?.keys[index] === key)) return cached.drafts;

      const holdings = catalog.holdings(ctx.inventory, ctx.itemDb);
      const cards: UpgradeCard[] = [];
      for (const entry of entries) {
        if (cards.length >= SUGGESTION_LIMIT) break;
        // A search is the one way to reach an owned one, so it looks at all of them.
        if (!needle && catalog.owns(entry.name, ctx.itemDb, holdings)) continue;
        const card = catalog.build(entry, ctx.itemDb, holdings);
        if (needle && !matches(needle, card)) continue;
        if (!cardMatchesVendors(card, vendors)) continue;
        cards.push(card);
      }
      const drafts = cards.map((card, order) => draftFor(card, order, activity === "low"));
      cached = { keys, drafts };
      return drafts;
    },
  };
}
