import { toMarketSlug } from "../../marketNaming.js";
import { curated, type CuratedLookup, type CuratedSource } from "./curated.js";
import { nemesisSteps } from "./nemesis.js";
import { relicCost } from "./relics.js";
import { UNKNOWN_EFFORT, type Ratings } from "./ratings.js";
import type { RawInventoryData } from "../../../types/inventory.js";
import type { RelicDatabase } from "../../../types/relics.js";
import type { PlanAfterQuest, PlanGroup, PlanGroupType, PlanSource } from "./plan/schema.js";
import type { QuestDone } from "./quests.js";
import type {
  AcquisitionPath,
  IncarnonInfo,
  NemesisPlan,
  PartPlan,
  PartState,
  PathCost,
  PathKind,
  PathStep,
  PlatCost,
  PlatPriceLookup,
} from "./types.js";

/** Base cost of walking a path at all, before what it covers and how hard it is. */
const BASE_EFFORT: Record<PathKind, number> = {
  market: 0.05,
  trade: 0.15,
  junction: 0.2,
  lab: 0.28,
  quest: 0.45,
  boss: 0.45,
  mission: 0.5,
  vendor: 0.55,
  bounty: 0.55,
  relics: 0.6,
  nemesis: 0.75,
  circuit: 0.8,
};

const CURATED_KINDS: Record<string, PathKind> = {
  market: "market",
  boss: "boss",
  mission: "mission",
  bounty: "bounty",
  quest: "quest",
  vendor: "vendor",
  lab: "lab",
  junction: "junction",
  nemesis: "nemesis",
};

const CIRCUIT_WHERE = "The Circuit, Duviri - normal mode weekly frame rotation";
const RELIC_WHERE = "Void Fissures - crack the relics that drop each part";
const TRADE_WHERE = "warframe.market - buy the parts from another player";

/** The Steel Path Circuit is a shorter run than the normal-mode frame rotation. */
const ADAPTER_EFFORT = 0.6;

/** Partial cover still helps, but a path that finishes the item beats one that does not. */
const PARTIAL_PENALTY = 0.15;
/** Difficulty pulls a path half a step either way; unknown sits at the middle. */
const EFFORT_SWING = 0.3;
const RELICS_IN_HAND_BONUS = 0.15;
const RELICS_EMPTY_PENALTY = 0.1;
const UNPRICED_PENALTY = 0.1;

const CREDITS_IN_TEXT = /([\d,.]+)\s*credits/i;

/** Curated market rows read "Market (35,000 Credits)". */
export function creditsFromWhere(where: string): number | null {
  const match = CREDITS_IN_TEXT.exec(where);
  if (!match) return null;
  const value = Number(match[1].replace(/[,.]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The in-game Market sells a main blueprint and never a component one, whatever
 *  a table row claims. */
function coveredBy(
  kind: PathKind,
  source: CuratedSource,
  missing: readonly PartState[],
): PartState[] {
  const half = kind === "market" ? "main" : source.parts;
  if (half === "both") return [...missing];
  const role = half === "main" ? "main" : "component";
  return missing.filter((part) => part.role === role);
}

/** A Market path short of the whole build is a blueprint price, not a route. */
function isBlueprintPrice(path: AcquisitionPath): boolean {
  return path.kind === "market" && !path.complete;
}

/** The route a card leads with and an item's effort is read off. */
export function headlinePath(paths: readonly AcquisitionPath[]): AcquisitionPath | null {
  return paths.find((path) => !isBlueprintPrice(path)) ?? null;
}

/** The plan rates the route left once its quest has paid out, so that one leads. */
const AFTER_QUEST_ID = "afterQuest";
const PLAN_ID = "plan";

/** The Circuit's frame rotation is an alternative, never the farm while one exists. */
function headlineRank(path: AcquisitionPath): number {
  if (path.id === AFTER_QUEST_ID) return -1;
  if (isBlueprintPrice(path)) return 2;
  return path.kind === "circuit" && path.covers.length > 0 ? 1 : 0;
}

function platFor(name: string, plat: PlatPriceLookup | null | undefined): number | null {
  if (!plat) return null;
  const value = plat(name);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function platCost(
  itemName: string,
  parts: readonly PartState[],
  plat: PlatPriceLookup | null | undefined,
): PlatCost | null {
  if (!plat) return null;
  const rows = parts.map((part) => ({
    name: part.name,
    plat: platFor(part.name, plat),
    slug: toMarketSlug(part.name) || null,
  }));
  const priced = rows.every((row) => row.plat !== null);
  const setName = platFor(`${itemName} Set`, plat) !== null ? `${itemName} Set` : itemName;
  return {
    set: platFor(setName, plat),
    setSlug: toMarketSlug(setName) || null,
    parts: rows,
    partsTotal: priced
      ? rows.reduce((sum, row, index) => sum + (row.plat ?? 0) * (parts[index]?.missing || 1), 0)
      : null,
  };
}

function effortFor(
  kind: PathKind,
  complete: boolean,
  difficulty: number | null,
  cost: PathCost,
): number {
  let effort = BASE_EFFORT[kind];
  if (!complete) effort += PARTIAL_PENALTY;
  effort += ((difficulty ?? UNKNOWN_EFFORT) - UNKNOWN_EFFORT) * EFFORT_SWING;
  if (cost.relics?.known) {
    effort += cost.relics.held >= cost.relics.needed ? -RELICS_IN_HAND_BONUS : 0;
    if (cost.relics.held === 0) effort += RELICS_EMPTY_PENALTY;
  }
  if (kind === "trade" && cost.plat?.set === null && cost.plat.partsTotal === null) {
    effort += UNPRICED_PENALTY;
  }
  return Math.max(0, Math.min(1, effort));
}

function makePath(
  id: string,
  kind: PathKind,
  steps: PathStep[],
  covers: readonly PartState[],
  missingCount: number,
  difficulty: number | null,
  cost: PathCost,
): AcquisitionPath {
  const complete = covers.length >= missingCount && missingCount > 0;
  return {
    id,
    kind,
    covers: covers.map((part) => part.name),
    complete,
    steps,
    cost,
    effort: effortFor(kind, complete, difficulty, cost),
  };
}

interface PathInputs {
  name: string;
  isPrime: boolean;
  parts: PartPlan;
  inventory: RawInventoryData | null;
  relicDb: RelicDatabase | null | undefined;
  plat: PlatPriceLookup | null | undefined;
  ratings: Ratings;
  /** The item itself is still missing, not only parts of it. */
  wanted?: boolean;
  /** Defaults to the shipped Warframe table. */
  curated?: CuratedLookup;
  /** Sources the app derives rather than reads out of a table. */
  extraSources?: readonly CuratedSource[];
  nemesis?: NemesisPlan | null;
  incarnon?: IncarnonInfo | null;
  /** Absent when the payload carries no quest progress. */
  questDone?: QuestDone | null;
  /** The plan's route once its quest has paid out, rated by the plan. */
  afterQuest?: PlanAfterQuest | null;
  /** The authored plan, the route for an item no table or derivation sources. */
  plan?: PlanRoute | null;
}

type PlanRoute = Pick<PlanAfterQuest, "effort" | "groups"> & { source?: PlanSource };

const ROUTE_KINDS: Partial<Record<PlanGroupType, PathKind>> = {
  vendor: "vendor",
  farm: "mission",
  bounty: "bounty",
  boss: "boss",
  relics: "relics",
  fissure: "relics",
};

/** Plan effort is 1-10; a path's is 0-1. */
const PLAN_EFFORT_SCALE = 10;

const PLACE_KINDS: ReadonlyArray<readonly [RegExp, PathKind]> = [
  [/^MARKET\b/, "market"],
  [/^CLAN DOJO\b/, "lab"],
];

function groupKind(group: PlanGroup): PathKind | undefined {
  const kind = ROUTE_KINDS[group.type];
  if (kind !== "vendor") return kind;
  return PLACE_KINDS.find(([pattern]) => pattern.test(group.place))?.[1] ?? kind;
}

/** A plan whose only way in is a gate reads as the one grind its source names. */
const SOURCE_KINDS: Partial<Record<PlanSource, PathKind>> = {
  dojo: "lab",
  bounties: "bounty",
  railjack: "mission",
  boss: "boss",
  relics: "relics",
  repeat: "mission",
  standing: "vendor",
  shop: "vendor",
};

function planLead(
  route: PlanRoute,
  questDone?: QuestDone | null,
): readonly [PlanGroup, PathKind] | null {
  const open = route.groups.filter((group) => !(group.quest && questDone?.(group.quest)));
  for (const group of open) {
    const kind = groupKind(group);
    if (kind) return [group, kind];
  }
  const gate = open.find((group) => group.type === "gate");
  const kind = route.source ? SOURCE_KINDS[route.source] : undefined;
  return gate && kind ? [gate, kind] : null;
}

function planPath(
  id: string,
  route: PlanRoute,
  missing: readonly PartState[],
  questDone?: QuestDone | null,
): AcquisitionPath | null {
  const found = planLead(route, questDone);
  if (!found) return null;
  const [lead, kind] = found;
  const where = lead.activity ? `${lead.place} - ${lead.activity}` : lead.place;
  return {
    id,
    kind,
    covers: missing.map((part) => part.name),
    complete: true,
    steps: [{ kind, where, parts: missing.map((part) => part.name) }],
    cost: { credits: null, plat: null, relics: null },
    effort: route.effort / PLAN_EFFORT_SCALE,
  };
}

function sourcesFor(input: PathInputs): CuratedSource[] {
  const table = (input.curated ?? curated)(input.name).sources;
  return [...table, ...(input.extraSources ?? [])];
}

function curatedPaths(input: PathInputs, missing: readonly PartState[]): AcquisitionPath[] {
  const difficulty = input.ratings.effort(input.name);
  const out: AcquisitionPath[] = [];
  let index = 0;
  for (const source of sourcesFor(input)) {
    const kind = CURATED_KINDS[source.kind];
    if (!kind) continue;
    // The nemesis run is modelled step by step, so a table row naming it would double up.
    if (kind === "nemesis" && input.nemesis) continue;
    // A finished quest never pays its reward out again, so a part still missing
    // after it has to come from somewhere else.
    if ((kind === "quest" || source.quest) && input.questDone?.(source.quest ?? source.where)) {
      continue;
    }
    const covers = coveredBy(kind, source, missing);
    if (covers.length === 0) continue;
    const credits = kind === "market" ? creditsFromWhere(source.where) : null;
    out.push(
      makePath(
        `${kind}:${index++}`,
        kind,
        [{ kind, where: source.where, parts: covers.map((part) => part.name) }],
        covers,
        missing.length,
        difficulty,
        { credits, plat: null, relics: null },
      ),
    );
  }
  return out;
}

/** The adapter is a Steel Path Circuit reward, not a part of any build, so it
 *  stands alone: it covers nothing and still completes what the player wants. */
function adapterPath(input: PathInputs, incarnon: IncarnonInfo): AcquisitionPath {
  const week = incarnon.week === null ? "" : `, week ${incarnon.week}`;
  return {
    id: "incarnon",
    kind: "circuit",
    covers: [],
    complete: true,
    steps: [
      {
        kind: "circuit",
        where: `Steel Path Circuit${week} - pick the ${input.name} Incarnon Genesis`,
        parts: [],
      },
    ],
    cost: { credits: null, plat: null, relics: null },
    effort: ADAPTER_EFFORT,
  };
}

function nemesisPath(input: PathInputs, plan: NemesisPlan, missing: readonly PartState[]) {
  return makePath(
    "nemesis",
    "nemesis",
    nemesisSteps(plan),
    missing,
    missing.length,
    input.ratings.effort(input.name),
    { credits: null, plat: null, relics: null },
  );
}

/** A nemesis weapon and anything else the item DB has no recipe for is handed
 *  over whole, so the item itself stands in for the parts a build would list. */
function wholeItem(name: string): PartState {
  return { uniqueName: "", name, role: "main", required: 1, owned: 0, building: 0, missing: 1 };
}

export function buildPaths(input: PathInputs): AcquisitionPath[] {
  const missing =
    input.wanted && !input.parts.known ? [wholeItem(input.name)] : input.parts.missing;
  if (missing.length === 0) {
    const incarnon = input.incarnon;
    return incarnon && !incarnon.owned ? [adapterPath(input, incarnon)] : [];
  }
  const difficulty = input.ratings.effort(input.name);
  const paths = curatedPaths(input, missing);
  const after = input.afterQuest ? planPath(AFTER_QUEST_ID, input.afterQuest, missing) : null;
  if (after) paths.push(after);
  const authored =
    !after && input.plan && sourcesFor(input).length === 0 && !input.nemesis
      ? planPath(PLAN_ID, input.plan, missing, input.questDone)
      : null;
  // A Prime's relic path already counts the relics in hand.
  if (authored && !(input.isPrime && authored.kind === "relics")) paths.push(authored);

  if (input.nemesis) paths.push(nemesisPath(input, input.nemesis, missing));
  if (input.incarnon && !input.incarnon.owned) paths.push(adapterPath(input, input.incarnon));

  // A Prime handed over whole, such as Venari Prime with Khora Prime, has no
  // parts for a relic to drop.
  if (input.isPrime && input.parts.known) {
    const relics = relicCost(missing, input.inventory, input.relicDb);
    paths.push(
      makePath(
        "relics",
        "relics",
        [{ kind: "relics", where: RELIC_WHERE, parts: missing.map((part) => part.name) }],
        missing,
        missing.length,
        difficulty,
        { credits: null, plat: null, relics },
      ),
    );
  }

  if ((input.curated ?? curated)(input.name).circuit) {
    paths.push(
      makePath(
        "circuit",
        "circuit",
        [{ kind: "circuit", where: CIRCUIT_WHERE, parts: [] }],
        missing,
        missing.length,
        difficulty,
        { credits: null, plat: null, relics: null },
      ),
    );
  }

  const plat = platCost(input.name, missing, input.plat);
  if (plat && (plat.set !== null || plat.parts.some((row) => row.plat !== null))) {
    paths.push(
      makePath(
        "trade",
        "trade",
        [{ kind: "trade", where: TRADE_WHERE, parts: missing.map((part) => part.name) }],
        missing,
        missing.length,
        difficulty,
        { credits: null, plat, relics: null },
      ),
    );
  }

  excusePurchasableBlueprint(paths, missing, difficulty);
  paths.sort(
    (a, b) => headlineRank(a) - headlineRank(b) || a.effort - b.effort || a.id.localeCompare(b.id),
  );
  return paths;
}

/** A farm short only of what the Market sells still finishes the item. */
function excusePurchasableBlueprint(
  paths: AcquisitionPath[],
  missing: readonly PartState[],
  difficulty: number | null,
): void {
  const bought = new Set(
    paths.filter((path) => path.kind === "market").flatMap((path) => path.covers),
  );
  if (bought.size === 0) return;
  for (const path of paths) {
    if (path.complete || path.kind === "market") continue;
    const covered = new Set(path.covers);
    if (missing.every((part) => covered.has(part.name) || bought.has(part.name))) {
      path.effort = effortFor(path.kind, true, difficulty, path.cost);
    }
  }
}
