import { ownedComponentCount } from "../../config/shared/componentNames.js";
import {
  GILDS,
  MODULAR_PARTS,
  MODULAR_PIECES,
  REFINED,
  type ModularPiece,
} from "../data/modularMastery.js";
import { SYNDICATE_TURN_INS } from "../data/syndicateTurnIns.js";
import { consumedSuitUniqueNames, isSubsumableFrame } from "./helminth.js";
import { buildMasteryPlan, type PlannerPin } from "./masteryPlanner.js";
import { copiesToBuild, frameNeeds } from "./suggest/acquisition/index.js";
import {
  buildOwnership,
  foundryBuilds,
  isSingleUsePart,
  ownsItem,
  withoutPartBlueprints,
} from "./suggest/acquisition/parts.js";
import type { ItemDbEntry, MasteryData, ParsedItem, RawInventoryData } from "../types/inventory.js";

export interface BuildDemandDriver {
  uniqueName: string;
  name: string;
}

export interface BuildDemand {
  units: number;
  /** The top-level items still to build that ask for it. */
  drivers: BuildDemandDriver[];
}

export interface BuildDemandInput {
  itemDb: Record<string, ItemDbEntry>;
  inventory: RawInventoryData | null;
  mastery: MasteryData | null;
}

type ItemDb = Record<string, ItemDbEntry>;
type Pool = Map<string, number>;

interface DemandPin {
  uniqueName: string;
  copies: number;
  drivers: BuildDemandDriver[];
}

interface DemandRow {
  units: number;
  drivers: Map<string, BuildDemandDriver>;
}

type Demand = Map<string, DemandRow>;

interface UnmasteredPiece {
  piece: ModularPiece;
  driver: BuildDemandDriver;
}

interface Account {
  /** Gear and parts in hand, foundry builds aside. */
  owned: Pool;
  /** Product -> builds the foundry holds for it. */
  building: Map<string, number>;
  subsumed: ReadonlySet<string>;
  /** Lower-cased names of Primes in hand, Next Up's convention for the kept copy. */
  primesOwned: ReadonlySet<string>;
}

function readAccount(
  inventory: RawInventoryData | null,
  itemDb: ItemDb,
  mastery: MasteryData | null,
): Account {
  const owned = buildOwnership(inventory, itemDb);
  const primesOwned = (mastery?.items ?? [])
    .filter((item) => item.isPrime && ownsItem(item.uniqueName ?? "", owned))
    .map((item) => item.name.toLowerCase());
  return {
    owned,
    building: foundryBuilds(inventory, itemDb),
    subsumed: new Set(consumedSuitUniqueNames(inventory)),
    primesOwned: new Set(primesOwned),
  };
}

/** What builds read from: parts built and the builds underway. */
function buildPool(account: Account, itemDb: ItemDb): Pool {
  const pool = withoutPartBlueprints(account.owned, itemDb);
  for (const [product, count] of account.building) {
    pool.set(product, (pool.get(product) ?? 0) + count);
  }
  return pool;
}

function driverOf(item: ParsedItem): BuildDemandDriver {
  return { uniqueName: item.uniqueName ?? "", name: item.displayName ?? item.name };
}

function frameCopies(item: ParsedItem, uniqueName: string, account: Account): number {
  const subsumed = account.subsumed.has(uniqueName);
  const owned = ownsItem(uniqueName, account.owned) || subsumed || item.status === "mastered";
  const needs = frameNeeds(owned, isSubsumableFrame(item.name), subsumed);
  const primeOwned = account.primesOwned.has(`${item.name.toLowerCase()} prime`);
  return copiesToBuild(needs, account.building.get(uniqueName) ?? 0, primeOwned);
}

function gearCopies(item: ParsedItem, uniqueName: string, pool: Pool): number {
  return item.status === "mastered" || ownsItem(uniqueName, pool) ? 0 : 1;
}

/** A gild recipe names a placeholder result; it builds nothing. */
function isGildRecipe(entry: ItemDbEntry | undefined): boolean {
  const blueprint = entry?.recipe?.blueprintUniqueName;
  return blueprint !== undefined && blueprint in GILDS;
}

function rosterPins(
  mastery: MasteryData | null,
  itemDb: ItemDb,
  account: Account,
  pool: Pool,
): DemandPin[] {
  return (mastery?.items ?? []).flatMap((item): DemandPin[] => {
    const uniqueName = item.uniqueName;
    if (!uniqueName || isGildRecipe(itemDb[uniqueName])) return [];
    const copies =
      item.category === "Warframes"
        ? frameCopies(item, uniqueName, account)
        : gearCopies(item, uniqueName, pool);
    return copies > 0 ? [{ uniqueName, copies, drivers: [driverOf(item)] }] : [];
  });
}

function unmasteredPieces(mastery: MasteryData | null): UnmasteredPiece[] {
  const roster = new Map((mastery?.items ?? []).map((item) => [item.uniqueName, item]));
  return MODULAR_PIECES.flatMap((piece): UnmasteredPiece[] => {
    const item = roster.get(piece.uniqueName);
    return item && item.status !== "mastered" ? [{ piece, driver: driverOf(item) }] : [];
  });
}

function ingredientUnits(uniqueName: string, itemDb: ItemDb): number {
  return (itemDb[uniqueName]?.recipe?.ingredients ?? []).reduce(
    (sum, ingredient) => sum + ingredient.count,
    0,
  );
}

const TURN_IN_ITEMS = new Set(
  Object.values(SYNDICATE_TURN_INS).flatMap(({ turnIns }) =>
    turnIns.flatMap((turnIn) => (turnIn.itemType ? [turnIn.itemType] : [])),
  ),
);

/** Fish part -> the most one fish yields of it. */
const BEST_FISH_YIELD = new Map<string, number>();
for (const { turnIns } of Object.values(SYNDICATE_TURN_INS)) {
  for (const part of turnIns.flatMap((turnIn) => turnIn.yields ?? [])) {
    if (part.itemType)
      BEST_FISH_YIELD.set(
        part.itemType,
        Math.max(BEST_FISH_YIELD.get(part.itemType) ?? 0, part.count),
      );
  }
}

/** Turn-in items behind some units of a material: a refined one counts as the
 *  raw finds it is cut from, a fish part as the fish it is cut out of. */
function turnInShare(material: string, units: number, itemDb: ItemDb): number {
  if (TURN_IN_ITEMS.has(material)) return units;
  const fishYield = BEST_FISH_YIELD.get(material);
  if (fishYield) return units / fishYield;
  const recipe = REFINED.has(material) ? itemDb[material]?.recipe : undefined;
  if (!recipe) return 0;
  const perUnit = units / Math.max(1, recipe.num || 1);
  return recipe.ingredients.reduce(
    (sum, ingredient) =>
      sum + turnInShare(ingredient.uniqueName, perUnit * ingredient.count, itemDb),
    0,
  );
}

/** Turn-in items one build of the part consumes from nothing. */
function turnInUnits(uniqueName: string, itemDb: ItemDb): number {
  const demand = plannedDemand([{ uniqueName, copies: 1, drivers: [] }], itemDb, new Map());
  return [...demand].reduce(
    (sum, [material, row]) => sum + turnInShare(material, row.units, itemDb),
    0,
  );
}

/** Fewest ingredient units, then fewest turn-in units, then uniqueName. The
 *  turn-in walk is costly, so only parts still tied on units take it. */
function cheapest(options: readonly string[], itemDb: ItemDb): string | undefined {
  const fewest = Math.min(...options.map((option) => ingredientUnits(option, itemDb)));
  const tied = options.filter((option) => ingredientUnits(option, itemDb) === fewest);
  const scored = tied.map((option) => ({
    option,
    turnIns: tied.length > 1 ? turnInUnits(option, itemDb) : 0,
  }));
  scored.sort((a, b) => a.turnIns - b.turnIns || (a.option < b.option ? -1 : 1));
  return scored[0]?.option;
}

/** One part for a slot: a built spare first, else the cheapest to build. */
function pickPart(
  types: readonly string[],
  itemDb: ItemDb,
  spares: Pool,
  cheapestBySlot: Map<string, string | undefined>,
): { uniqueName: string; held: boolean } | null {
  const options = types.flatMap((type) => MODULAR_PARTS[type] ?? []).sort();
  const spare = options.find((uniqueName) => (spares.get(uniqueName) ?? 0) > 0);
  if (spare) {
    spares.set(spare, (spares.get(spare) ?? 0) - 1);
    return { uniqueName: spare, held: true };
  }
  const slot = types.join("|");
  if (!cheapestBySlot.has(slot)) cheapestBySlot.set(slot, cheapest(options, itemDb));
  const built = cheapestBySlot.get(slot);
  return built ? { uniqueName: built, held: false } : null;
}

function addPin(pins: Map<string, DemandPin>, uniqueName: string, driver: BuildDemandDriver): void {
  const pin = pins.get(uniqueName) ?? { uniqueName, copies: 0, drivers: [] };
  pin.copies += 1;
  pin.drivers.push(driver);
  pins.set(uniqueName, pin);
}

/** The parts each unmastered piece is assembled with, one per slot. */
function companionPins(
  pieces: readonly UnmasteredPiece[],
  itemDb: ItemDb,
  pool: Pool,
): DemandPin[] {
  const spares = new Map(pool);
  const pins = new Map<string, DemandPin>();
  const cheapestBySlot = new Map<string, string | undefined>();
  for (const { piece, driver } of pieces) {
    for (const types of piece.slots) {
      const part = pickPart(types, itemDb, spares, cheapestBySlot);
      if (part && !part.held) addPin(pins, part.uniqueName, driver);
    }
  }
  return [...pins.values()];
}

function addDemand(
  demand: Demand,
  uniqueName: string,
  units: number,
  drivers: readonly BuildDemandDriver[],
): void {
  const row = demand.get(uniqueName) ?? { units: 0, drivers: new Map() };
  row.units += units;
  for (const driver of drivers) row.drivers.set(driver.uniqueName, driver);
  demand.set(uniqueName, row);
}

function gildDemand(pieces: readonly UnmasteredPiece[]): Demand {
  const demand: Demand = new Map();
  for (const { piece, driver } of pieces) {
    for (const cost of piece.gild ? (GILDS[piece.gild] ?? []) : []) {
      addDemand(demand, cost.uniqueName, cost.count, [driver]);
    }
  }
  return demand;
}

/** What each build's walk still asks for, below whatever is built already. */
function plannedDemand(pins: readonly DemandPin[], itemDb: ItemDb, pool: Pool): Demand {
  const plannerPins = pins.map(
    (pin): PlannerPin => ({
      uniqueName: pin.uniqueName,
      name: pin.uniqueName,
      imageUrl: null,
      masteryXpRemaining: 0,
      copies: pin.copies,
    }),
  );
  const demand: Demand = new Map();
  buildMasteryPlan(plannerPins, itemDb, pool, { allocate: false }).items.forEach((item, index) => {
    for (const resource of item.resources) {
      addDemand(demand, resource.uniqueName, resource.needed, pins[index]?.drivers ?? []);
    }
  });
  return demand;
}

function merged(...parts: readonly Demand[]): Demand {
  const demand: Demand = new Map();
  for (const part of parts) {
    for (const [uniqueName, row] of part) {
      addDemand(demand, uniqueName, row.units, [...row.drivers.values()]);
    }
  }
  return demand;
}

/** A material the planner stops at that is really one more build. */
function isBuiltMaterial(uniqueName: string, itemDb: ItemDb): boolean {
  return REFINED.has(uniqueName) || isSingleUsePart(uniqueName, itemDb);
}

/** Built materials short of what is held, each as a build of the shortfall. */
function expansionPins(demand: Demand, itemDb: ItemDb, pool: Pool): DemandPin[] {
  return [...demand].flatMap(([uniqueName, row]): DemandPin[] => {
    if (!isBuiltMaterial(uniqueName, itemDb)) return [];
    const short = row.units - ownedComponentCount(uniqueName, pool);
    return short > 0 ? [{ uniqueName, copies: short, drivers: [...row.drivers.values()] }] : [];
  });
}

function sameBuilds(a: readonly DemandPin[], b: readonly DemandPin[]): boolean {
  const copies = new Map(a.map((pin) => [pin.uniqueName, pin.copies]));
  return a.length === b.length && b.every((pin) => copies.get(pin.uniqueName) === pin.copies);
}

/** Expands built materials until another pass changes nothing. */
function expandedDemand(base: Demand, itemDb: ItemDb, pool: Pool): Demand {
  let builds: DemandPin[] = [];
  for (;;) {
    const demand = merged(base, plannedDemand(builds, itemDb, pool));
    const next = expansionPins(demand, itemDb, pool);
    if (sameBuilds(builds, next)) return demand;
    builds = next;
  }
}

/** uniqueName -> units the items still to build consume, walked from each top
 *  item down through every part not already built or in the foundry. */
export function remainingBuildDemand(input: BuildDemandInput): Map<string, BuildDemand> {
  const { itemDb, inventory, mastery } = input;
  const account = readAccount(inventory, itemDb, mastery);
  const pool = buildPool(account, itemDb);
  const pieces = unmasteredPieces(mastery);
  const pins = [
    ...rosterPins(mastery, itemDb, account, pool),
    ...companionPins(pieces, itemDb, pool),
  ];
  const base = merged(plannedDemand(pins, itemDb, pool), gildDemand(pieces));
  const demand = new Map<string, BuildDemand>();
  for (const [uniqueName, row] of expandedDemand(base, itemDb, pool)) {
    demand.set(uniqueName, { units: row.units, drivers: [...row.drivers.values()] });
  }
  return demand;
}
