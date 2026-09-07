import { get } from "svelte/store";

import { formatNumber } from "../../format.js";
import { overframeRankingsRevision } from "../../../stores/overframeRankings.js";
import { resolveAcquisition } from "../acquisition/index.js";
import { includesTarget } from "../acquisition/kinds.js";
import { compareAcquisition } from "../acquisition/sort.js";
import { clamp01 } from "../score.js";
import type { MessageKey } from "../../i18n.js";
import type {
  AcquisitionPath,
  AcquisitionTarget,
  PartPlan,
  PathKind,
} from "../acquisition/types.js";
import type {
  SuggestionContext,
  SuggestionDraft,
  SuggestionPreferences,
  SuggestionProvider,
  WhySegment,
} from "../../../types/suggest.js";

interface RatingEntry {
  rank?: string;
  difficulty?: string;
}

/** The whole domain answers to one activity setting, as Nightwave's acts do. */
export const ACQUISITION_ACTIVITY = "acquisition";

/** The feed is a shortlist; there is a whole game's worth of gear behind it. */
const SUGGESTION_LIMIT = 6;

/** Every part is in hand and the foundry will take it: nothing left to farm. */
const READY_EFFORT = 0.05;
/** Every part is in hand but the raw materials are not. */
const MATERIALS_EFFORT = 0.35;
/** Nothing the app knows will finish this one. */
const NO_ROUTE_EFFORT = 1;

const KIND_LABEL: Record<PathKind, MessageKey> = {
  market: "common.market",
  trade: "nextUp.acqKindTrade",
  lab: "nextUp.acqKindLab",
  junction: "nextUp.acqKindJunction",
  quest: "common.quest",
  boss: "nextUp.acqKindBoss",
  mission: "common.mission",
  bounty: "nextUp.acqKindBounty",
  vendor: "nextUp.acqKindVendor",
  relics: "nextUp.acqKindRelics",
  circuit: "nextUp.acqKindCircuit",
  nemesis: "nextUp.acqKindNemesis",
};

export function pathKindLabel(kind: PathKind): MessageKey {
  return KIND_LABEL[kind];
}

function totalParts(parts: PartPlan): number {
  return (parts.main ? 1 : 0) + parts.components.length;
}

function ownedParts(parts: PartPlan): number {
  return totalParts(parts) - parts.missing.length;
}

/** A resolver effort of 1 means "no path known", which is not the same as a
 *  build the player could start this second. */
function effortFor(target: AcquisitionTarget): number {
  if (target.paths.length > 0) return clamp01(target.effort);
  if (!target.parts.known || target.parts.missing.length > 0) return NO_ROUTE_EFFORT;
  return target.parts.buildable ? READY_EFFORT : MATERIALS_EFFORT;
}

function titleKey(target: AcquisitionTarget): MessageKey {
  if (target.needs.includes("mastery")) {
    return target.parts.known ? "nextUp.acquisitionBuild" : "nextUp.acquisitionGet";
  }
  if (target.needs.includes("subsume")) return "nextUp.acquisitionSubsume";
  return "nextUp.acquisitionAdapter";
}

/** The one number a route is remembered by: relics held, plat, or credits. */
function pathCostText(path: AcquisitionPath, t: SuggestionContext["t"]): string | null {
  const relics = path.cost.relics;
  if (relics?.known) {
    return t(relics.held >= relics.needed ? "nextUp.acqRelicsReady" : "nextUp.acqRelicsShort", {
      held: String(relics.held),
      needed: String(relics.needed),
    });
  }
  const plat = path.cost.plat;
  if (plat) {
    const set = plat.set;
    if (set !== null) return t("nextUp.acqPlatSet", { plat: String(Math.round(set)) });
    if (plat.partsTotal !== null) {
      return t("nextUp.acqPlatParts", { plat: String(Math.round(plat.partsTotal)) });
    }
  }
  if (path.cost.credits !== null) {
    return t("nextUp.acqCredits", { credits: formatNumber(path.cost.credits) });
  }
  return null;
}

function routeText(target: AcquisitionTarget, t: SuggestionContext["t"]): string {
  const path = target.paths[0];
  if (!path) return t("nextUp.whyAcqNoRoute");
  const label = t(KIND_LABEL[path.kind]);
  const cost = pathCostText(path, t);
  return cost ? `${label}, ${cost}` : label;
}

function stateText(target: AcquisitionTarget, t: SuggestionContext["t"]): string | null {
  const parts = target.parts;
  if (!parts.known) return null;
  const total = totalParts(parts);
  if (parts.missing.length > 0) {
    return t(total === 1 ? "nextUp.whyAcqPartsOne" : "nextUp.whyAcqParts", {
      missing: String(parts.missing.length),
      total: String(total),
    });
  }
  if (parts.buildable) return t("nextUp.whyAcqReady");
  const short = parts.materials.filter((row) => row.missing > 0).length;
  return t("nextUp.whyAcqMaterials", { count: String(short) });
}

function whySegments(target: AcquisitionTarget, t: SuggestionContext["t"]): WhySegment[] {
  const out: WhySegment[] = [];
  const state = stateText(target, t);
  const ready = target.parts.known && target.parts.missing.length === 0;
  if (state)
    out.push(ready && target.parts.buildable ? { text: state, tone: "good" } : { text: state });
  // A build already in hand needs no route: there is nothing left to walk.
  if (!ready) {
    const route = routeText(target, t);
    out.push(target.paths.length === 0 ? { text: route, tone: "bad" } : { text: route });
  }
  return out;
}

let cached: { keys: readonly unknown[]; targets: AcquisitionTarget[] } | null = null;

/** The player's own tier and difficulty in the shape the resolver reads supplied
 *  ratings in, which is what puts them above the shipped and overframe tables.
 *  Storing them by name is also what carries them over a data regeneration. */
export function acquisitionRatings(prefs: SuggestionPreferences): Record<string, RatingEntry> {
  const source: Record<string, RatingEntry> = {};
  for (const [name, rank] of Object.entries(prefs.acquisitionTiers)) source[name] = { rank };
  for (const [name, difficulty] of Object.entries(prefs.acquisitionDifficulty)) {
    source[name] = { ...source[name], difficulty };
  }
  return source;
}

/** The sweep walks the whole item database, and the feed re-derives on a timer;
 *  only a change to what it reads can change what it returns. */
function targetsFor(ctx: SuggestionContext): AcquisitionTarget[] {
  const { prefs } = ctx;
  const keys = [
    ctx.itemDb,
    ctx.inventory,
    ctx.relicDb,
    ctx.plat,
    prefs.acquisitionTiers,
    prefs.acquisitionDifficulty,
    // A refreshed overframe table changes every rank the sweep just cached.
    get(overframeRankingsRevision),
  ] as const;
  if (cached && keys.every((key, index) => cached?.keys[index] === key)) return cached.targets;
  const targets = resolveAcquisition({
    itemDb: ctx.itemDb,
    inventory: ctx.inventory,
    relicDb: ctx.relicDb,
    plat: ctx.plat,
    ratings: acquisitionRatings(prefs),
  });
  cached = { keys, targets };
  return targets;
}

export const acquisitionProvider: SuggestionProvider = {
  id: "acquisition",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const { prefs, t } = ctx;
    const activity = prefs.activities[ACQUISITION_ACTIVITY] ?? "normal";
    if (activity === "never") return [];

    return targetsFor(ctx)
      .filter((target) => includesTarget(prefs.options.acquisitionKinds, target))
      .map((target) => ({ target, effort: effortFor(target) }))
      .sort(compareAcquisition(prefs.options.acquisitionSort, prefs.options.acquisitionSortDir))
      .slice(0, SUGGESTION_LIMIT)
      .map(({ target, effort }, order) => {
        const total = totalParts(target.parts);
        const owned = ownedParts(target.parts);
        const segments = whySegments(target, t);
        return {
          id: `acquisition:${target.uniqueName}`,
          order,
          category: "acquisition" as const,
          title: t(titleKey(target), { item: target.displayName ?? target.name }),
          why: segments.map((segment) => segment.text).join(" - "),
          whySegments: segments,
          reward: { name: target.name, uniqueName: target.uniqueName },
          ...(target.rank ? { grade: target.rank } : {}),
          // Easiest first is the whole point, so value has to run with effort
          // rather than against the scorer's own effort penalty.
          signals: { value: 1 - effort, effort, urgency: 0 },
          // Every part handed in changes the grind, so a dismissal lifts once
          // the player has actually got one of them.
          fingerprint: `${target.uniqueName}|${target.needs.join("+")}|${owned}/${total}`,
          deprioritized: activity === "low",
          ...(total > 0 ? { progress: { current: owned, required: total } } : {}),
          wiki: target.name,
          details: { acquisition: target },
        };
      });
  },
};
