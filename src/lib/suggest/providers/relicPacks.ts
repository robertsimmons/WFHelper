import { AYA_PATH } from "../relicPacks.js";
import { RELICS_ACTIVITY } from "./relics.js";
import type {
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
} from "../../../types/suggest.js";

/** Ahead of every relic whatever the goal or order: the band's orders start at 0. */
const RELIC_PACKS_DRAFT: SuggestionDraft = {
  id: "relic-packs",
  order: -1,
  category: "relics",
  title: "Relic packs",
  why: "",
  reward: { name: "Aya", uniqueName: AYA_PATH },
  signals: { value: 1, effort: 0, urgency: 0, gain: 1 },
  fingerprint: "relic-packs",
  details: { relicPacks: true },
};

const DRAFTS = [RELIC_PACKS_DRAFT];

/** The relics band's lead card; it reads its facts from the stores itself. */
export const relicPacksProvider: SuggestionProvider = {
  id: "relic-packs",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    return (ctx.prefs.activities[RELICS_ACTIVITY] ?? "normal") === "never" ? [] : DRAFTS;
  },
};
