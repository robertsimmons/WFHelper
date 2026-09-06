import { curated, type CuratedSource } from "./curated.js";
import { relicCost } from "./relics.js";
import { UNKNOWN_DIFFICULTY, type Ratings } from "./ratings.js";
import type { RawInventoryData } from "../../../types/inventory.js";
import type { RelicDatabase } from "../../../types/relics.js";
import type {
  AcquisitionPath,
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

/** Partial cover still helps, but a path that finishes the item beats one that does not. */
const PARTIAL_PENALTY = 0.15;
/** Difficulty pulls a path half a step either way; unknown sits at the middle. */
const DIFFICULTY_SWING = 0.3;
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

function coveredBy(source: CuratedSource, missing: readonly PartState[]): PartState[] {
  if (source.parts === "both") return [...missing];
  const role = source.parts === "main" ? "main" : "component";
  return missing.filter((part) => part.role === role);
}

function platFor(name: string, plat: PlatPriceLookup | null | undefined): number | null {
  if (!plat) return null;
  const value = plat(name);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function platCost(
  itemName: string,
  parts: readonly PartState[],
  plat: PlatPriceLookup | null | undefined,
): PlatCost | null {
  if (!plat) return null;
  const rows = parts.map((part) => ({ name: part.name, plat: platFor(part.name, plat) }));
  const priced = rows.every((row) => row.plat !== null);
  return {
    set: platFor(`${itemName} Set`, plat) ?? platFor(itemName, plat),
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
  effort += ((difficulty ?? UNKNOWN_DIFFICULTY) - UNKNOWN_DIFFICULTY) * DIFFICULTY_SWING;
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

export interface PathInputs {
  name: string;
  isPrime: boolean;
  parts: PartPlan;
  inventory: RawInventoryData | null;
  relicDb: RelicDatabase | null | undefined;
  plat: PlatPriceLookup | null | undefined;
  ratings: Ratings;
}

function curatedPaths(input: PathInputs, missing: readonly PartState[]): AcquisitionPath[] {
  const difficulty = input.ratings.difficulty(input.name);
  const out: AcquisitionPath[] = [];
  let index = 0;
  for (const source of curated(input.name).sources) {
    const kind = CURATED_KINDS[source.kind];
    if (!kind) continue;
    const covers = coveredBy(source, missing);
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

export function buildPaths(input: PathInputs): AcquisitionPath[] {
  const missing = input.parts.missing;
  if (missing.length === 0) return [];
  const difficulty = input.ratings.difficulty(input.name);
  const paths = curatedPaths(input, missing);

  if (input.isPrime) {
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

  if (curated(input.name).circuit) {
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

  paths.sort((a, b) => a.effort - b.effort || a.id.localeCompare(b.id));
  return paths;
}
