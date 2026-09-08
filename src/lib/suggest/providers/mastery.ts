import { itemLabel } from "../../itemLabel.js";
import {
  buildMasteryRoadmap,
  type MasteryRoadmap,
  type MasteryRoadmapSourceItem,
} from "../../masteryRoadmap.js";
import { clamp01 } from "../score.js";
import type { MasteryData, ParsedItem } from "../../../types/inventory.js";
import type {
  MasteryKind,
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

/** Deep enough that the pager runs out only when the roadmap does. Unmeasured:
 *  a lift needs a perf run behind it. */
const SUGGESTION_LIMIT = 40;

/** How close a thing is to done is what makes it easy, so that carries the
 *  value; the mastery on offer only separates two equally short grinds. */
const CLOSENESS_WEIGHT = 0.75;

interface Levelable {
  rank: number;
  maxRank: number;
  category: string;
  uniqueName?: string;
}

const FRAME_CATEGORIES = new Set(["Warframes"]);

const WEAPON_CATEGORIES = new Set(["Primary", "Secondary", "Melee", "Amps", "Necramech"]);

/** The K-Drive override files boards under `Misc`, and the profile files the
 *  Plexus under `Companions`; both answer to the companion box. */
const COMPANION_CATEGORIES = new Set(["Companions", "Misc"]);

/** One Archwing category holds the suits and their guns alike, so the database
 *  path breaks the tie the way the mastery service's own affinity rate does. */
const ARCH_SUIT_PATH = /\/(?:SpaceSuits?|Powersuits\/Archwing)\//i;

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

/** A Forma dump is its own grind, so it answers to that box rather than to the
 *  one its gear would otherwise sit under. */
function kindOf(item: Levelable): MasteryKind | null {
  if (needsFormaDump(item)) return "forma";
  if (FRAME_CATEGORIES.has(item.category)) return "frame";
  if (WEAPON_CATEGORIES.has(item.category)) return "weapon";
  if (COMPANION_CATEGORIES.has(item.category)) return "companion";
  if (item.category === "Archwing") {
    return ARCH_SUIT_PATH.test(item.uniqueName ?? "") ? "frame" : "weapon";
  }
  return null;
}

function keeps(prefs: SuggestionPreferences, item: Levelable): boolean {
  const kinds = prefs.options.masteryKinds;
  if (kinds.length === 0) return true;
  const kind = kindOf(item);
  // `Other` is the category resolver's fallback, so no box can honestly name
  // what lands there; hiding it would lose the grind where nobody would look.
  return kind === null || kinds.includes(kind);
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

let cached: { mastery: MasteryData | null; easy: MasteryRoadmap["easy"] } | null = null;

/** Two full passes over the roster, and the feed re-derives on a timer, so the
 *  roadmap is rebuilt only when the roster it reads is a different object. The
 *  boxes and the activity setting are read after this and cost nothing. */
function easyFor(ctx: SuggestionContext): MasteryRoadmap["easy"] {
  if (cached && cached.mastery === ctx.mastery) return cached.easy;
  const owned = (ctx.mastery?.items ?? []).filter((item) => item.currentlyOwned === true);
  const easy = buildMasteryRoadmap(owned.map(sourceItem)).easy;
  cached = { mastery: ctx.mastery, easy };
  return easy;
}

export const masteryProvider: SuggestionProvider = {
  id: "mastery",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const { prefs, t } = ctx;
    const activity = prefs.activities[MASTERY_ACTIVITY] ?? "normal";
    if (activity === "never") return [];

    return easyFor(ctx)
      .filter((item) => keeps(prefs, item))
      .sort((a, b) => effortFor(a) - effortFor(b) || a.name.localeCompare(b.name))
      .slice(0, SUGGESTION_LIMIT)
      .map((item) => {
        const points = item.masteryXpRemaining;
        return {
          id: `mastery:${itemKey(item)}`,
          category: "mastery" as const,
          title: t("nextUp.masteryLevel", { item: itemLabel(item) }),
          // The rank bar already reads as the rank and what is left of it.
          why: "",
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
