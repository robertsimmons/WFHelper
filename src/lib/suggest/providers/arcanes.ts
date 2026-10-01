import { ARCANE_CATALOG } from "../arcanes.js";
import { VOSFOR_PATH } from "../vosfor.js";
import { createUpgradeProvider } from "./upgrades.js";
import type {
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
} from "../../../types/suggest.js";

export const ARCANES_ACTIVITY = "arcanes";

const upgrades = createUpgradeProvider(ARCANE_CATALOG, ARCANES_ACTIVITY, "arcaneSearch");

/** Ahead of every arcane whatever the search or order: the band's orders start at 0. */
const VOSFOR_DRAFT: SuggestionDraft = {
  id: "vosfor",
  order: -1,
  category: "arcanes",
  title: "Vosfor",
  why: "",
  reward: { name: "Vosfor", uniqueName: VOSFOR_PATH },
  signals: { value: 1, effort: 0, urgency: 0, gain: 1 },
  fingerprint: "vosfor",
  details: { vosfor: true },
};

let cached: { from: SuggestionDraft[]; drafts: SuggestionDraft[] } | null = null;

export const arcanesProvider: SuggestionProvider = {
  id: upgrades.id,

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    if ((ctx.prefs.activities[ARCANES_ACTIVITY] ?? "normal") === "never") return [];
    const from = upgrades.collect(ctx);
    if (cached?.from !== from) cached = { from, drafts: [VOSFOR_DRAFT, ...from] };
    return cached.drafts;
  },
};
