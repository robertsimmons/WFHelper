import { itemLabel } from "../../itemLabel.js";
import { buildMasteryRoadmap, type MasteryRoadmapSourceItem } from "../../masteryRoadmap.js";
import { clamp01 } from "../score.js";
import type { ParsedItem } from "../../../types/inventory.js";
import type {
  SuggestionContext,
  SuggestionDraft,
  SuggestionPreferences,
  SuggestionProvider,
} from "../../../types/suggest.js";

/** The whole domain answers to one activity setting, as Nightwave's acts do. */
export const MASTERY_ACTIVITY = "mastery";

/** Past this rank, gear with a higher cap only climbs on Forma. */
const FORMA_GATE_RANK = 30;

/** Ranking a Warframe from nothing is the biggest single mastery win there is. */
const MASTERY_POINT_REFERENCE = 6000;

/** The feed is a shortlist; the Mastery tab is where the whole roadmap lives. */
const SUGGESTION_LIMIT = 5;

/** How close a thing is to done is what makes it easy, so that carries the
 *  value; the mastery on offer only separates two equally short grinds. */
const CLOSENESS_WEIGHT = 0.75;

interface Levelable {
  rank: number;
  maxRank: number;
  category: string;
}

function ranksLeft(item: Levelable): number {
  return Math.max(0, item.maxRank - item.rank);
}

function effortFor(item: Levelable): number {
  return clamp01(ranksLeft(item) / Math.max(item.maxRank, 1));
}

function valueFor(item: Levelable, points: number): number {
  const closeness = 1 - effortFor(item);
  const payoff = clamp01(points / MASTERY_POINT_REFERENCE);
  return CLOSENESS_WEIGHT * closeness + (1 - CLOSENESS_WEIGHT) * payoff;
}

/** Necramechs, Coda and lich weapons sit at 30 until Forma goes into them. */
function needsFormaDump(item: Levelable): boolean {
  return item.maxRank > FORMA_GATE_RANK && item.rank >= FORMA_GATE_RANK;
}

/** Frames and weapons are still every item this reads; only the Forma entry
 *  narrows anything yet. */
function keeps(prefs: SuggestionPreferences, item: Levelable): boolean {
  const kinds = prefs.options.masteryKinds;
  if (kinds.length > 0 && !kinds.includes("forma") && needsFormaDump(item)) return false;
  return true;
}

/** Nothing here is being bought or farmed, so only the roadmap's own read of
 *  what is still worth ranking matters; price and foundry state do not. */
function sourceItem(item: ParsedItem): MasteryRoadmapSourceItem {
  return {
    ...item,
    masteryXpRemaining: item.masteryXpRemaining ?? 0,
    platinum: item.platinum ?? null,
    estimatedCost: null,
    owned: true,
    foundryState: undefined,
  };
}

function itemKey(item: ParsedItem): string {
  return item.uniqueName || item.internalName;
}

export const masteryProvider: SuggestionProvider = {
  id: "mastery",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const { prefs, t } = ctx;
    const activity = prefs.activities[MASTERY_ACTIVITY] ?? "normal";
    if (activity === "never") return [];

    const owned = (ctx.mastery?.items ?? []).filter((item) => item.currentlyOwned === true);
    const roadmap = buildMasteryRoadmap(owned.map(sourceItem));

    return roadmap.easy
      .filter((item) => keeps(prefs, item))
      .sort((a, b) => effortFor(a) - effortFor(b) || a.name.localeCompare(b.name))
      .slice(0, SUGGESTION_LIMIT)
      .map((item) => {
        const points = item.masteryXpRemaining;
        return {
          id: `mastery:${itemKey(item)}`,
          category: "mastery" as const,
          title: t("nextUp.masteryLevel", { item: itemLabel(item) }),
          why: [
            t("nextUp.whyMasteryRank", { rank: String(item.rank), max: String(item.maxRank) }),
            t("nextUp.whyMasteryPoints", { points: String(points) }),
          ].join(" - "),
          reward: { name: item.name, uniqueName: item.uniqueName },
          signals: { value: valueFor(item, points), effort: effortFor(item), urgency: 0 },
          // Any rank earned changes the grind, so a dismissal lifts once the
          // player has actually put affinity into it.
          fingerprint: `${itemKey(item)}|${item.rank}`,
          deprioritized: activity === "low",
          progress: { current: item.rank, required: item.maxRank },
          wiki: item.name,
        };
      });
  },
};
