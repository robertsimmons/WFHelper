// The Inventory "Safe to sell" question, end to end on production-shaped data:
// the item DB comes from the real builder over the bundled @wfcd/items and
// warframe-public-export-plus packages, mastery from the real masteryHelper
// over raw inventory.json-shaped input, and rows go through the same parse,
// tab, flag and filter steps InventoryView.svelte runs. The WFM catalog is not
// loaded, so part tradability falls back to the item DB as it does at startup.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import * as itemDatabase from "../../../services/itemDatabase";
import * as masteryHelper from "../../../services/masteryHelper";
import { withoutFoundryPending } from "../../../config/shared/foundryPending";
import { applySharedFiltersAndSort } from "../../../src/lib/filters";
import { parseInventory } from "../../../src/lib/inventory";
import { DEFAULT_SAFETY_SETTINGS, safeToList } from "../../../src/lib/inventory/safetyRules";
import {
  buildBaseInventoryItems,
  buildInventoryViewItems,
  type InventoryFilterTab,
} from "../../../src/lib/inventoryMarket";
import { attachPartMasteryFlags, buildPartMasteryResolver } from "../../../src/lib/parentMastery";
import { buildSelectionSafetyContext } from "../../../src/lib/tradeWorkbench/queueModel";
import type { SharedFiltersState } from "../../../src/types/filters";
import type { ItemDbEntry, MasteryData, ParsedItem } from "../../../src/types/inventory";

const WR = "/Lotus/Types/Recipes/WarframeRecipes/";
const WP = "/Lotus/Types/Recipes/Weapons/WeaponParts/";
const WB = "/Lotus/Types/Recipes/Weapons/";
const AW = "/Lotus/Types/Recipes/ArchwingRecipes/PrimeArchwing/";

const VAUBAN = "/Lotus/Powersuits/Trapper/TrapperPrime";
const V_BP = `${WR}VaubanPrimeBlueprint`;
const V_CHASSIS_BP = `${WR}VaubanPrimeChassisBlueprint`;
const V_SYSTEMS_BP = `${WR}VaubanPrimeSystemsBlueprint`;
const V_HELMET = `${WR}VaubanPrimeHelmetComponent`;

const SOMA = "/Lotus/Weapons/Tenno/LongGuns/PrimeSoma/PrimeSomaRifle";
const SOMA_BP = `${WB}SomaPrimeBlueprint`;
const SOMA_BARREL = `${WP}SomaPrimeBarrel`;
const SOMA_RECEIVER = `${WP}SomaPrimeReceiver`;
const SOMA_STOCK = `${WP}SomaPrimeStock`;

const OKINA = "/Lotus/Weapons/Tenno/Melee/Swords/PrimeOkina/PrimeOkina";
const OKINA_BLADE = `${WP}OkinaPrimeBlade`;
const OKINA_HANDLE = `${WP}OkinaPrimeHandle`;

const BRONCO = "/Lotus/Weapons/Tenno/Pistol/BroncoPrime";
const BRONCO_BP = `${WB}BroncoPrimeBlueprint`;
const BRONCO_BARREL = `${WP}BroncoPrimeBarrel`;
const BRONCO_RECEIVER = `${WP}BroncoPrimeReceiver`;
const AKBRONCO = "/Lotus/Weapons/Tenno/Akimbo/PrimeAkimboShotGun";
const AKBRONCO_BP = `${WB}AkbroncoPrimeBlueprint`;
const AKBRONCO_LINK = `${WP}AkbroncoPrimeLink`;

const ODONATA = "/Lotus/Powersuits/Archwing/PrimeJetPack/PrimeJetPack";

const CARRIER = "/Lotus/Types/Sentinels/SentinelPowersuits/PrimeCarrierPowerSuit";
const CARRIER_CARAPACE = `${WP}PrimeCarrierCarapace`;
const CARRIER_CEREBRUM = `${WP}PrimeCarrierCerebrum`;

const KAVASA_COLLAR_BP = "/Lotus/Types/Recipes/Kubrow/Collars/PrimeKubrowCollarABlueprint";
const RHINO_CHASSIS_BP = `${WR}RhinoChassisBlueprint`;

/* ---------------------------------------------------------------------------
 * Judgment calls. Each verdict the oracle depends on lives here, so changing
 * one is one edit.
 * ------------------------------------------------------------------------- */
const JUDGMENT = {
  /** One part held as blueprint + built component: the blueprint is the copy
   *  sold, the built component the copy kept. False flips it. */
  mixedPileSellsBlueprintFirst: true,
  /** A built but unmastered item already exists, so its parts are free. False
   *  keeps one set of parts until it is mastered. */
  builtUnmasteredFreesParts: true,
  /** A mastered item that was sold (XPInfo only) is not in hand when another
   *  recipe wants to consume it. True counts it as one held copy. */
  soldMasteredCountsAsHeld: false,
  /** A prime part nothing masterable builds (Kavasa collar) is free in full. */
  partWithoutMasterableParentIsFree: true,
};

/** Which spelling of a frame part's mixed pile carries the sellable copy. */
const mixedPileSoldRow = (part: string): string =>
  `${WR}${part}${JUDGMENT.mixedPileSellsBlueprintFirst ? "Blueprint" : "Component"}`;

// Affinity for max rank: suits/companions/archwings 1000 * 30^2, weapons 500 * 30^2.
const SUIT_MAX_XP = 900_000;
const WEAPON_MAX_XP = 450_000;

/** Prime parts + Safe to sell, everything else at the shipped defaults. */
const SAFE_TO_SELL_FILTERS: SharedFiltersState = {
  search: "",
  primeMode: "prime",
  masteredMode: "all",
  sortBy: "ducats",
  sortDirection: "desc",
  orderPlaced: "all",
  mastered: "all",
  spares: "yes",
  vaulted: "all",
  partType: "all",
  favorite: "all",
  minimumPlatinum: 0,
  minimumAmount: 0,
  equipped: "all",
  leveledUp: "all",
  subsumed: "all",
  foundryState: "all",
};

type Inventory = Record<string, unknown>;
type Stack = { ItemType: string; ItemCount: number };

const stack = (ItemType: string, ItemCount = 1): Stack => ({ ItemType, ItemCount });
const gear = (ItemType: string, XP = 0) => ({ ItemType, XP });

function inventory(slices: Inventory): Inventory {
  return { Recipes: [], MiscItems: [], XPInfo: [], PendingRecipes: [], ...slices };
}

interface SellRow {
  name: string;
  internalName: string;
  owned: number;
  /** The row's own sellable count, what the grid card and item modal show. */
  sellable: number;
  /** What the bulk sell queue would list for this row (verdict.safe). */
  bulkSell: number;
  primeWithDucats: boolean;
}

interface SafeToSellResult {
  shown: Map<string, SellRow>;
  everyRow: Map<string, SellRow>;
}

let itemDb: Record<string, ItemDbEntry>;

interface RunOptions {
  keepVariants?: boolean;
  tab?: InventoryFilterTab;
}

// Every consumer here reads only each item's mastery status, which comes from
// the gear collections and XPInfo alone, so runs sharing those reuse one
// computeMasteryProgress result. It clones the whole item DB per call.
const GEAR_SLICES = ["Suits", "LongGuns", "Pistols", "Melee", "Sentinels", "SpaceSuits", "XPInfo"];
const masteryCache = new Map<string, MasteryData>();
function masteryFor(raw: Inventory): MasteryData {
  const key = JSON.stringify(GEAR_SLICES.map((slice) => raw[slice] ?? null));
  let mastery = masteryCache.get(key);
  if (!mastery) {
    mastery = masteryHelper.computeMasteryProgress(raw) as unknown as MasteryData;
    masteryCache.set(key, mastery);
  }
  return mastery;
}

/** InventoryView.svelte's pipeline: parsedItems from the foundry-adjusted
 *  inventory, the tab's base and view rows, mastery flags, shared filters. */
function safeToSell(raw: Inventory, options: RunOptions = {}): SafeToSellResult {
  const mastery = masteryFor(raw);
  const usable = withoutFoundryPending(
    raw as { Recipes?: unknown; PendingRecipes?: unknown },
    (uniqueName) => itemDb[uniqueName]?.reusableBlueprint === true,
  );
  const parsed: ParsedItem[] = parseInventory(usable as never, itemDb);
  const base = buildBaseInventoryItems(parsed, options.tab ?? "all_parts", {}, {}, {});
  const view = buildInventoryViewItems(base, {});
  const resolve = buildPartMasteryResolver(itemDb, mastery, raw, {
    keepVariants: options.keepVariants === true,
  });
  const flagged = attachPartMasteryFlags(view, resolve);
  const visible = applySharedFiltersAndSort(flagged, SAFE_TO_SELL_FILTERS).filter(
    (row) => typeof row.ducats === "number" && row.ducats > 0,
  );

  const safety = buildSelectionSafetyContext({
    itemDb,
    settings: DEFAULT_SAFETY_SETTINGS,
    mastery,
    pins: [],
    inventory: raw,
    keepVariants: options.keepVariants === true,
  });
  const toRow = (row: (typeof flagged)[number]): SellRow => {
    const source = parsed.find(
      (item) => (item.inventoryKey ?? item.internalName) === row.internalName,
    );
    return {
      name: row.name,
      internalName: row.internalName,
      owned: row.amount,
      sellable: typeof row.sellable === "number" ? row.sellable : row.spare ? row.amount : 0,
      bulkSell: source ? safeToList(source, safety).safe : 0,
      primeWithDucats: row.isPrime === true && typeof row.ducats === "number" && row.ducats > 0,
    };
  };

  return {
    shown: new Map(visible.map((row) => [row.internalName, toRow(row)])),
    everyRow: new Map(flagged.map((row) => [row.internalName, toRow(row)])),
  };
}

/** Shown under Safe to sell with exactly `count` sellable, and the bulk sell
 *  queue offering the same count. */
function expectSellable(result: SafeToSellResult, uniqueName: string, count: number): void {
  const row = result.shown.get(uniqueName);
  expect(row, `${uniqueName} should be shown as safe to sell`).toBeDefined();
  expect(row?.sellable, `${uniqueName} sellable`).toBe(count);
  expect(row?.bulkSell, `${uniqueName} bulk sell quantity`).toBe(count);
}

/** Not shown under Safe to sell, and nothing of it offered to the bulk sell queue. */
function expectKept(result: SafeToSellResult, uniqueName: string): void {
  expect(result.shown.has(uniqueName), `${uniqueName} should not be shown as safe to sell`).toBe(
    false,
  );
  const row = result.everyRow.get(uniqueName);
  expect(row, `${uniqueName} should still be an inventory row`).toBeDefined();
  expect(row?.sellable, `${uniqueName} sellable`).toBe(0);
  expect(row?.bulkSell, `${uniqueName} bulk sell quantity`).toBe(0);
}

beforeAll(() => {
  itemDatabase.buildDatabase();
  itemDb = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
});

/* ---------------------------------------------------------------------------
 * Matrix model. A family is gear plus the slots its recipes consume; a case is
 * a state per gear and a pile per slot.
 * ------------------------------------------------------------------------- */
type GearState =
  | "none"
  | "building"
  | "built-unmastered"
  | "built-mastered"
  | "sold-mastered"
  | "two-built-mixed";

interface Gear {
  label: string;
  uniqueName: string;
  mainBlueprint: string;
  collection: "Suits" | "LongGuns" | "Pistols" | "Melee" | "Sentinels" | "SpaceSuits";
  /** Affinity per rank squared: 1000 for suits and companions, 500 for weapons. */
  rate: number;
}

interface Slot {
  label: string;
  /** Gear whose build consumes this slot. */
  gear: Gear;
  perBuild: number;
  /** Recipes spelling (an unbuilt part blueprint, or the gear's main blueprint). */
  blueprint?: string;
  /** MiscItems spelling (a built part). */
  component?: string;
}

/** Copies of a slot held: as blueprint, as built component, and blueprints the
 *  foundry is currently turning into the component. */
interface Pile {
  bp: number;
  comp: number;
  building: number;
}

interface Consumption {
  consumer: Gear;
  consumed: Gear;
  perBuild: number;
}

interface Family {
  gears: Gear[];
  slots: Slot[];
  consumes: Consumption[];
}

interface MatrixCase {
  name: string;
  states: Map<Gear, GearState>;
  piles: Map<Slot, Pile>;
  keepVariants: boolean;
}

const EMPTY: Pile = { bp: 0, comp: 0, building: 0 };

/* ---------------------------------------------------------------------------
 * Oracle. Plain arithmetic over the states, nothing from the app.
 * ------------------------------------------------------------------------- */
const isMastered = (state: GearState): boolean =>
  state === "built-mastered" || state === "sold-mastered" || state === "two-built-mixed";

/** Copies in hand or coming out of the foundry. */
function heldCopies(state: GearState): number {
  if (state === "two-built-mixed") return 2;
  if (state === "built-unmastered" || state === "built-mastered" || state === "building") return 1;
  if (state === "sold-mastered") return JUDGMENT.soldMasteredCountsAsHeld ? 1 : 0;
  return 0;
}

/** Copies of `gear` still to be built: enough to master it once, and enough
 *  for every unbuilt consumer, whichever is more (a mastered copy can still be
 *  consumed). keepVariants adds one to survive the consumer's build. */
function buildsNeeded(family: Family, testCase: MatrixCase, gear: Gear): number {
  const state = testCase.states.get(gear) ?? "none";
  const held = heldCopies(state);

  let consumerDemand = 0;
  for (const link of family.consumes) {
    if (link.consumed !== gear) continue;
    consumerDemand += link.perBuild * buildsNeeded(family, testCase, link.consumer);
  }
  if (testCase.keepVariants && consumerDemand > 0) consumerDemand += 1;

  const masteryHeld =
    state === "built-unmastered" && !JUDGMENT.builtUnmasteredFreesParts ? 0 : held;
  const forMastery = isMastered(state) ? 0 : Math.max(0, 1 - masteryHeld);
  const forConsumers = Math.max(0, consumerDemand - held);
  return Math.max(forMastery, forConsumers);
}

/** Expected sellable copies of each spelling of a slot. */
function expectedSellable(
  family: Family,
  testCase: MatrixCase,
  slot: Slot,
): { bp: number; comp: number } {
  const pile = testCase.piles.get(slot) ?? EMPTY;
  // A part already building counts toward what the gear needs.
  const stillNeeded = Math.max(
    0,
    slot.perBuild * buildsNeeded(family, testCase, slot.gear) - pile.building,
  );
  const kept = Math.min(pile.bp + pile.comp, stillNeeded);
  const keptComp = JUDGMENT.mixedPileSellsBlueprintFirst
    ? Math.min(pile.comp, kept)
    : kept - Math.min(pile.bp, kept);
  const keptBp = kept - keptComp;
  return { bp: pile.bp - keptBp, comp: pile.comp - keptComp };
}

/* ---------------------------------------------------------------------------
 * Case -> raw inventory.json slices -> pipeline -> per-part comparison.
 * ------------------------------------------------------------------------- */
const MAX_RANK_SQUARED = 30 * 30;
const RANK_5_SQUARED = 5 * 5;

function rawInventoryFor(family: Family, testCase: MatrixCase): Inventory {
  const recipes = new Map<string, number>();
  const misc = new Map<string, number>();
  const pending: Array<{ ItemType: string }> = [];
  const slices: Record<string, Array<{ ItemType: string; XP: number }>> = { XPInfo: [] };
  const add = (into: Map<string, number>, key: string, count: number) => {
    if (count > 0) into.set(key, (into.get(key) ?? 0) + count);
  };

  for (const gear of family.gears) {
    const state = testCase.states.get(gear) ?? "none";
    const maxXp = gear.rate * MAX_RANK_SQUARED;
    const built = (slices[gear.collection] ??= []);
    if (state === "building") {
      // The foundry keeps the spent blueprint in Recipes until the build is claimed.
      pending.push({ ItemType: gear.mainBlueprint });
      add(recipes, gear.mainBlueprint, 1);
    }
    if (state === "built-unmastered") built.push(gear_(gear, gear.rate * RANK_5_SQUARED));
    if (state === "built-mastered") built.push(gear_(gear, maxXp));
    if (state === "two-built-mixed") built.push(gear_(gear, maxXp), gear_(gear, 0));
    if (state !== "none" && state !== "building") {
      const xp = state === "built-unmastered" ? gear.rate * RANK_5_SQUARED : maxXp;
      slices.XPInfo.push(gear_(gear, xp));
    }
  }

  for (const slot of family.slots) {
    const pile = testCase.piles.get(slot) ?? EMPTY;
    if (slot.blueprint) add(recipes, slot.blueprint, pile.bp + pile.building);
    if (slot.component) add(misc, slot.component, pile.comp);
    for (let i = 0; i < pile.building; i++) pending.push({ ItemType: slot.blueprint! });
  }

  return inventory({
    ...slices,
    Recipes: [...recipes].map(([key, count]) => stack(key, count)),
    MiscItems: [...misc].map(([key, count]) => stack(key, count)),
    PendingRecipes: pending,
  });
}

function gear_(gear: Gear, XP: number) {
  return { ItemType: gear.uniqueName, XP };
}

/** Every disagreement between the oracle and the app for one family's slots,
 *  read off a pipeline run that may also hold other families' rows. */
function mismatches(family: Family, testCase: MatrixCase, result: SafeToSellResult): string[] {
  const out: string[] = [];
  for (const slot of family.slots) {
    const pile = testCase.piles.get(slot) ?? EMPTY;
    const expected = expectedSellable(family, testCase, slot);
    const spellings: Array<[string | undefined, number, number, string]> = [
      [slot.blueprint, pile.bp, expected.bp, slot.component ? " blueprint" : ""],
      [slot.component, pile.comp, expected.comp, slot.blueprint ? " component" : ""],
    ];
    for (const [uniqueName, owned, want, suffix] of spellings) {
      if (!uniqueName || owned === 0) continue;
      const label = `${slot.label}${suffix} (owned ${owned})`;
      const row = result.everyRow.get(uniqueName);
      if (!row) {
        out.push(`${label}: no inventory row`);
        continue;
      }
      if (row.sellable !== want)
        out.push(`${label}: grid sellable expected ${want} got ${row.sellable}`);
      if (row.bulkSell !== want)
        out.push(`${label}: bulk sell expected ${want} got ${row.bulkSell}`);
      if (result.shown.has(uniqueName) !== want > 0) {
        out.push(`${label}: safe-to-sell filter ${want > 0 ? "hides" : "shows"} it`);
      }
    }
  }
  return out;
}

function cartesian<T extends unknown[]>(...axes: { [K in keyof T]: readonly T[K][] }): T[] {
  return axes.reduce<unknown[][]>(
    (acc, axis) => acc.flatMap((prefix) => axis.map((value) => [...prefix, value])),
    [[]],
  ) as T[];
}

/** Rows over `axes` such that every value combination of each axis group in
 *  `groups` appears at least once (a covering array). Greedy and deterministic:
 *  each step takes the candidate covering the most still-missing tuples. */
function coveringRows<T>(axes: T[][], groups: number[][]): T[][] {
  const tupleKey = (row: T[], group: number[]) =>
    `${group.join(",")}|${group.map((axis) => JSON.stringify(row[axis])).join(",")}`;
  const candidates = cartesian(...axes) as T[][];
  const missing = new Set<string>();
  for (const row of candidates) for (const group of groups) missing.add(tupleKey(row, group));

  const rows: T[][] = [];
  while (missing.size > 0) {
    let best = candidates[0];
    let bestGain = -1;
    for (const row of candidates) {
      let gain = 0;
      for (const group of groups) if (missing.has(tupleKey(row, group))) gain++;
      if (gain > bestGain) {
        best = row;
        bestGain = gain;
      }
    }
    for (const group of groups) missing.delete(tupleKey(best, group));
    rows.push(best);
  }
  return rows;
}

/** Every pair of axes. */
function allPairs(axisCount: number): number[][] {
  const pairs: number[][] = [];
  for (let a = 0; a < axisCount; a++) for (let b = a + 1; b < axisCount; b++) pairs.push([a, b]);
  return pairs;
}

const pile = (bp = 0, comp = 0, building = 0): Pile => ({ bp, comp, building });

/* ---------------------------------------------------------------------------
 * Families.
 * ------------------------------------------------------------------------- */
const ALL_STATES: GearState[] = [
  "none",
  "building",
  "built-unmastered",
  "built-mastered",
  "sold-mastered",
];

const BRONCO_GEAR: Gear = {
  label: "Bronco",
  uniqueName: BRONCO,
  mainBlueprint: BRONCO_BP,
  collection: "Pistols",
  rate: 500,
};
const AKBRONCO_GEAR: Gear = {
  label: "Akbronco",
  uniqueName: AKBRONCO,
  mainBlueprint: AKBRONCO_BP,
  collection: "Pistols",
  rate: 500,
};
const B_BP: Slot = {
  label: "Bronco blueprint",
  gear: BRONCO_GEAR,
  perBuild: 1,
  blueprint: BRONCO_BP,
};
const B_BARREL: Slot = {
  label: "barrel",
  gear: BRONCO_GEAR,
  perBuild: 1,
  component: BRONCO_BARREL,
};
const B_RECEIVER: Slot = {
  label: "receiver",
  gear: BRONCO_GEAR,
  perBuild: 1,
  component: BRONCO_RECEIVER,
};
const AK_BP: Slot = {
  label: "Akbronco blueprint",
  gear: AKBRONCO_GEAR,
  perBuild: 1,
  blueprint: AKBRONCO_BP,
};
const AK_LINK: Slot = { label: "link", gear: AKBRONCO_GEAR, perBuild: 1, component: AKBRONCO_LINK };
const AKBRONCO_FAMILY: Family = {
  gears: [BRONCO_GEAR, AKBRONCO_GEAR],
  slots: [B_BP, B_BARREL, B_RECEIVER, AK_BP, AK_LINK],
  consumes: [{ consumer: AKBRONCO_GEAR, consumed: BRONCO_GEAR, perBuild: 2 }],
};

// Weapon parts exist in DE's data under one spelling only (WeaponParts/<Part>,
// held in MiscItems); there is no unbuilt-blueprint form, so the "mixed
// spelling" pile is impossible for this family and is not generated. Every
// other combination of states is reachable (Broncos can be bought, built and
// sold independently of Akbronco), so nothing else is dropped: the Bronco x
// Akbronco x keepVariants x pile product is run in full.
const AKBRONCO_PILES: Record<string, Array<[Slot, Pile]>> = {
  full: [
    [B_BP, pile(2)],
    [B_BARREL, pile(0, 2)],
    [B_RECEIVER, pile(0, 2)],
    [AK_LINK, pile(0, 1)],
    [AK_BP, pile(1)],
  ],
  partial: [
    [B_BARREL, pile(0, 1)],
    [B_RECEIVER, pile(0, 2)],
  ],
  surplus: [
    [B_BP, pile(3)],
    [B_BARREL, pile(0, 3)],
    [B_RECEIVER, pile(0, 3)],
    [AK_LINK, pile(0, 3)],
    [AK_BP, pile(3)],
  ],
};

const BRONCO_STATES: GearState[] = [...ALL_STATES, "two-built-mixed"];
const akbroncoCases: MatrixCase[] = cartesian<[GearState, GearState, boolean, string]>(
  BRONCO_STATES,
  ALL_STATES,
  [false, true],
  Object.keys(AKBRONCO_PILES),
).map(([bronco, akbronco, keepVariants, pileName]) => ({
  name: `Bronco: ${bronco}, Akbronco: ${akbronco}, keepVariants: ${keepVariants ? "on" : "off"}, pile: ${pileName}`,
  states: new Map([
    [BRONCO_GEAR, bronco],
    [AKBRONCO_GEAR, akbronco],
  ]),
  piles: new Map(AKBRONCO_PILES[pileName]),
  keepVariants,
}));

/** A single-gear family: its slots, plus covering rows of pile values per
 *  state. Each gear state gets the same rows. */
interface SingleGearFamily {
  title: string;
  family: Family;
  gear: Gear;
  rowsPerState: Array<{ label: string; piles: Map<Slot, Pile> }>;
}

function singleGearCases(spec: SingleGearFamily): MatrixCase[] {
  return ALL_STATES.flatMap((state) =>
    spec.rowsPerState.map((row) => ({
      name: `${spec.gear.label}: ${state}, ${row.label}`,
      states: new Map([[spec.gear, state]]),
      piles: row.piles,
      keepVariants: false,
    })),
  );
}

function gearOf(spec: {
  label: string;
  uniqueName: string;
  mainBlueprint: string;
  collection: Gear["collection"];
  rate: number;
}): Gear {
  return { ...spec };
}

/* Frames and archwings: a main blueprint plus parts held as an unbuilt
 * blueprint (Recipes, ...Blueprint) or a built component (MiscItems,
 * ...Component). */
const PART_FORMS: Record<string, Pile> = {
  blueprint: pile(1, 0),
  component: pile(0, 1),
  both: pile(1, 1),
  none: pile(0, 0),
  duplicates: pile(2, 0),
};
const FORM_NAMES = Object.keys(PART_FORMS);

interface FrameSpec {
  title: string;
  gear: Gear;
  /** [slot label, ...Blueprint uniqueName, ...Component uniqueName] */
  parts: Array<[string, string, string]>;
  mainCounts: number[];
  firstPartBuilding: number[];
}

/** Rows cover every pair of axes (part forms, main blueprint count, first part
 *  building) and, where a foundry axis exists, every first-part form x main
 *  count x building triple. */
function frameFamily(spec: FrameSpec): SingleGearFamily {
  const gear = spec.gear;
  const main: Slot = { label: "main blueprint", gear, perBuild: 1, blueprint: gear.mainBlueprint };
  const parts: Slot[] = spec.parts.map(([label, blueprint, component]) => ({
    label,
    gear,
    perBuild: 1,
    blueprint,
    component,
  }));
  const axes: Array<Array<string | number>> = [
    ...parts.map(() => FORM_NAMES),
    spec.mainCounts,
    spec.firstPartBuilding,
  ];
  const mainAxis = parts.length;
  const buildingAxis = parts.length + 1;
  const groups = allPairs(axes.length);
  if (spec.firstPartBuilding.length > 1) groups.push([0, mainAxis, buildingAxis]);

  const rowsPerState = coveringRows(axes, groups).map((row) => {
    const mainCount = row[mainAxis] as number;
    const building = row[buildingAxis] as number;
    const piles = new Map<Slot, Pile>([[main, pile(mainCount)]]);
    parts.forEach((slot, i) => {
      const form = PART_FORMS[row[i] as string];
      piles.set(slot, i === 0 ? { ...form, building } : form);
    });
    const layout = parts.map((slot, i) => `${slot.label}: ${row[i]}`).join(", ");
    const foundry =
      spec.firstPartBuilding.length > 1
        ? `, ${parts[0].label} building: ${building ? "yes" : "no"}`
        : "";
    return { label: `${layout}, main blueprint: ${mainCount}${foundry}`, piles };
  });
  return {
    title: spec.title,
    gear,
    family: { gears: [gear], slots: [main, ...parts], consumes: [] },
    rowsPerState,
  };
}

const framePart = (prefix: string, name: string, slot: string): [string, string, string] => [
  slot,
  `${prefix}${name}Blueprint`,
  `${prefix}${name}Component`,
];

/* Weapons and companions whose parts have one spelling (WeaponParts/<Part> in
 * MiscItems): pile sizes per part, rows covering every pair of parts. */
interface CountedSpec {
  title: string;
  gear: Gear;
  /** [slot label, uniqueName, per build] */
  parts: Array<[string, string, number]>;
  sizes: number[];
  mainSizes: number[];
}

function countedFamily(spec: CountedSpec): SingleGearFamily {
  const gear = spec.gear;
  const main: Slot = { label: "blueprint", gear, perBuild: 1, blueprint: gear.mainBlueprint };
  const parts: Slot[] = spec.parts.map(([label, component, perBuild]) => ({
    label,
    gear,
    perBuild,
    component,
  }));
  const axes = [spec.mainSizes, ...parts.map(() => spec.sizes)];
  const rowsPerState = coveringRows(axes, allPairs(axes.length)).map(([mainCount, ...sizes]) => {
    const piles = new Map<Slot, Pile>([[main, pile(mainCount)]]);
    parts.forEach((slot, i) => piles.set(slot, pile(0, sizes[i])));
    const sizeLabel = parts.map((slot, i) => `${slot.label} x${sizes[i]}`).join(", ");
    return { label: `blueprint x${mainCount}, ${sizeLabel}`, piles };
  });
  return {
    title: spec.title,
    gear,
    family: { gears: [gear], slots: [main, ...parts], consumes: [] },
    rowsPerState,
  };
}

// Nyx Prime was a second frame with the same data shape as Vauban (Suits,
// WarframeRecipes ...Blueprint/...Component parts); its verdicts matched
// Vauban's case for case, so Vauban stands for both.
const VAUBAN_FAMILY = frameFamily({
  title: "frame matrix: Vauban Prime",
  gear: gearOf({
    label: "Vauban",
    uniqueName: VAUBAN,
    mainBlueprint: V_BP,
    collection: "Suits",
    rate: 1000,
  }),
  parts: [
    framePart(WR, "VaubanPrimeChassis", "chassis"),
    framePart(WR, "VaubanPrimeSystems", "systems"),
    framePart(WR, "VaubanPrimeHelmet", "neuroptics"),
  ],
  mainCounts: [0, 1, 2],
  firstPartBuilding: [0, 1],
});

const ODONATA_FAMILY = frameFamily({
  title: "archwing matrix: Odonata Prime",
  gear: gearOf({
    label: "Odonata",
    uniqueName: ODONATA,
    mainBlueprint: `${AW}PrimeArchwingBlueprint`,
    collection: "SpaceSuits",
    rate: 1000,
  }),
  parts: [
    framePart(AW, "PrimeArchwingChassis", "harness"),
    framePart(AW, "PrimeArchwingWings", "wings"),
    framePart(AW, "PrimeArchwingSystems", "systems"),
  ],
  mainCounts: [0, 1],
  firstPartBuilding: [0],
});

const SOMA_FAMILY = countedFamily({
  title: "single weapon matrix: Soma Prime",
  gear: gearOf({
    label: "Soma",
    uniqueName: SOMA,
    mainBlueprint: SOMA_BP,
    collection: "LongGuns",
    rate: 500,
  }),
  parts: [
    ["barrel", SOMA_BARREL, 1],
    ["receiver", SOMA_RECEIVER, 1],
    ["stock", SOMA_STOCK, 1],
  ],
  sizes: [0, 1, 2],
  mainSizes: [0, 1, 2],
});

const OKINA_FAMILY = countedFamily({
  title: "two-per-build weapon matrix: Okina Prime (2 blades, 2 handles)",
  gear: gearOf({
    label: "Okina",
    uniqueName: OKINA,
    mainBlueprint: `${WB}OkinaPrimeBlueprint`,
    collection: "Melee",
    rate: 500,
  }),
  parts: [
    ["blade", OKINA_BLADE, 2],
    ["handle", OKINA_HANDLE, 2],
  ],
  sizes: [0, 1, 2, 3],
  mainSizes: [0, 1, 2, 3],
});

const CARRIER_FAMILY = countedFamily({
  title: "companion matrix: Carrier Prime",
  gear: gearOf({
    label: "Carrier",
    uniqueName: CARRIER,
    mainBlueprint: "/Lotus/Types/Recipes/SentinelRecipes/PrimeCarrierSentinelBlueprint",
    collection: "Sentinels",
    rate: 1000,
  }),
  parts: [
    ["carapace", CARRIER_CARAPACE, 1],
    ["cerebrum", CARRIER_CEREBRUM, 1],
    ["systems", `${WP}PrimeCarrierSystems`, 1],
  ],
  sizes: [0, 1, 2],
  mainSizes: [0, 1],
});

const SINGLE_GEAR_FAMILIES = [
  VAUBAN_FAMILY,
  ODONATA_FAMILY,
  SOMA_FAMILY,
  OKINA_FAMILY,
  CARRIER_FAMILY,
];

/* ---------------------------------------------------------------------------
 * Batching. The pipeline is per inventory and costs ~25ms, and families share
 * no items, so one run carries an Akbronco case plus one case of every
 * single-gear family. Bronco x Akbronco states form 30 groups of 6 runs
 * (keepVariants x pile); group g carries every single-gear family in
 * ALL_STATES[g % 5], so each group still needs only one mastery computation
 * and each state gets 36 runs per family. The guard test below proves no
 * recipe consumes the single-gear families' gear, which is what makes
 * keepVariants and the other riders irrelevant to their verdicts.
 * ------------------------------------------------------------------------- */
const RUNS_PER_GROUP = 6;

interface Rider {
  family: SingleGearFamily;
  testCase: MatrixCase | null;
}

const casesBySpec = new Map<SingleGearFamily, MatrixCase[]>();
function casesOf(spec: SingleGearFamily): MatrixCase[] {
  let cases = casesBySpec.get(spec);
  if (!cases) {
    cases = singleGearCases(spec);
    casesBySpec.set(spec, cases);
  }
  return cases;
}

const riders: Rider[][] = akbroncoCases.map(() => []);
const batchOf = new Map<MatrixCase, number>();
akbroncoCases.forEach((testCase, run) => batchOf.set(testCase, run));

const stateOfRun = (run: number): GearState =>
  ALL_STATES[Math.floor(run / RUNS_PER_GROUP) % ALL_STATES.length];

for (const spec of SINGLE_GEAR_FAMILIES) {
  const cases = casesOf(spec);
  for (const state of ALL_STATES) {
    const runs = akbroncoCases.map((_, run) => run).filter((run) => stateOfRun(run) === state);
    const forState = cases.filter((testCase) => testCase.states.get(spec.gear) === state);
    if (forState.length > runs.length) {
      throw new Error(`${spec.title}: ${forState.length} ${state} rows exceed ${runs.length} runs`);
    }
    runs.forEach((run, i) => {
      const testCase = forState[i] ?? null;
      riders[run].push({ family: spec, testCase });
      if (testCase) batchOf.set(testCase, run);
    });
  }
}

function mergeInventories(parts: Inventory[]): Inventory {
  const merged: Record<string, unknown[]> = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (Array.isArray(value)) (merged[key] ??= []).push(...value);
    }
  }
  return merged;
}

const runResults = new Map<number, SafeToSellResult>();
function resultOfRun(run: number): SafeToSellResult {
  let result = runResults.get(run);
  if (!result) {
    const akbronco = akbroncoCases[run];
    const raw = mergeInventories([
      rawInventoryFor(AKBRONCO_FAMILY, akbronco),
      ...riders[run].map(({ family, testCase }) =>
        rawInventoryFor(
          family.family,
          testCase ?? {
            name: "",
            states: new Map([[family.gear, stateOfRun(run)]]),
            piles: new Map(),
            keepVariants: false,
          },
        ),
      ),
    ]);
    result = safeToSell(raw, { keepVariants: akbronco.keepVariants });
    runResults.set(run, result);
  }
  return result;
}

function runMatrix(family: Family, cases: MatrixCase[]): void {
  it.each(cases.map((testCase) => [testCase.name, testCase] as const))("%s", (_name, testCase) => {
    const wrong = mismatches(family, testCase, resultOfRun(batchOf.get(testCase)!));
    expect(wrong, `\n  ${wrong.join("\n  ")}\n`).toEqual([]);
  });
}

describe("batching guard", () => {
  it("no recipe consumes a single-gear family's gear, and no two families share an item", () => {
    const gears = new Set(SINGLE_GEAR_FAMILIES.map((spec) => spec.gear.uniqueName));
    const consumed = Object.entries(itemDb).filter(([, entry]) =>
      (entry.components ?? []).some((component) => component.uniqueName !== undefined && gears.has(component.uniqueName)),
    );
    expect(consumed.map(([uniqueName]) => uniqueName)).toEqual([]);

    const owners = new Map<string, string>();
    for (const family of [AKBRONCO_FAMILY, ...SINGLE_GEAR_FAMILIES.map((spec) => spec.family)]) {
      const label = family.gears.map((gear) => gear.label).join("+");
      const items = [
        ...family.gears.map((gear) => gear.uniqueName),
        ...family.slots.flatMap((slot) => [slot.blueprint, slot.component]),
      ].filter((item): item is string => !!item);
      for (const item of new Set(items)) {
        expect(owners.get(item), `${item} in ${label}`).toBeUndefined();
        owners.set(item, label);
      }
    }
  });
});

describe("Akbronco / Bronco matrix", () => {
  runMatrix(AKBRONCO_FAMILY, akbroncoCases);
});

for (const spec of SINGLE_GEAR_FAMILIES) {
  describe(spec.title, () => {
    runMatrix(spec.family, casesOf(spec));
  });
}

describe("rows that are not prime parts", () => {
  const ownedSetAndRhinoPart = () =>
    inventory({
      Recipes: [stack(SOMA_BP), stack(RHINO_CHASSIS_BP)],
      MiscItems: [stack(SOMA_BARREL), stack(SOMA_RECEIVER), stack(SOMA_STOCK)],
      XPInfo: [gear(SOMA, WEAPON_MAX_XP), gear("/Lotus/Powersuits/Rhino/Rhino", SUIT_MAX_XP)],
    });

  it("lists the parts of a complete prime set but never the set row or a non-prime part", () => {
    const result = safeToSell(ownedSetAndRhinoPart(), { tab: "everything" });
    expect([...result.shown.values()].filter((row) => /\sSet$/i.test(row.name))).toEqual([]);
    expect(result.shown.has(RHINO_CHASSIS_BP)).toBe(false);
    expectSellable(result, SOMA_BP, 1);
    expectSellable(result, SOMA_BARREL, 1);
    expectSellable(result, SOMA_RECEIVER, 1);
    expectSellable(result, SOMA_STOCK, 1);
    expect(result.shown.size).toBe(4);
  });

  it("shows nothing on the Full Sets tab", () => {
    const result = safeToSell(ownedSetAndRhinoPart(), { tab: "full_sets" });
    expect([...result.everyRow.values()].some((row) => /\sSet$/i.test(row.name))).toBe(true);
    expect([...result.shown.values()]).toEqual([]);
  });
});

describe("a prime part nothing in the mastery catalogue builds (Kavasa Prime collar)", () => {
  it(`is ${JUDGMENT.partWithoutMasterableParentIsFree ? "free to sell in full" : "kept"}`, () => {
    const result = safeToSell(inventory({ Recipes: [stack(KAVASA_COLLAR_BP, 2)] }));
    if (JUDGMENT.partWithoutMasterableParentIsFree) expectSellable(result, KAVASA_COLLAR_BP, 2);
    else expectKept(result, KAVASA_COLLAR_BP);
  });
});

describe("the user's real inventory", () => {
  // Captured by tests/fixtures/safe-to-sell/captureInventorySlice.mjs from
  // %APPDATA%/wfhelper/api-helper/inventory.json on 2026-10-03.
  const fixture = path.join(__dirname, "../../fixtures/safe-to-sell/user-inventory-slice.json");
  const userInventory = (): Inventory => JSON.parse(fs.readFileSync(fixture, "utf-8"));

  // Player-correct answer. Unmastered, unowned frames (Baruuk, Mirage, Nekros, Nyx,
  // Styanax, Trinity, Vauban, Odonata) keep one of each part; where both the
  // blueprint and the built part are held, the blueprint is the copy to sell.
  const EXPECTED: Record<string, number> = {
    [`${WP}AcceltraPrimeReceiver`]: 1,
    [`${WP}AcceltraPrimeStock`]: 1,
    [`${WP}AfentisPrimeBarrel`]: 1,
    [`${WP}AkbroncoPrimeLink`]: 1,
    [mixedPileSoldRow("BaruukPrimeChassis")]: 1,
    [`${WP}BratonPrimeReceiver`]: 1,
    [`${WP}BratonPrimeStock`]: 1,
    [`${WP}BroncoPrimeBarrel`]: 3,
    [`${WB}BroncoPrimeBlueprint`]: 1,
    [`${WP}BroncoPrimeReceiver`]: 1,
    [`${WP}BurstonPrimeBarrel`]: 1,
    [`${WP}CedoPrimeBarrel`]: 2,
    [`${WP}CedoPrimeReceiver`]: 3,
    [`${WP}CobraCranePrimeBlade`]: 2,
    [`${WP}PrimeDaikyuLowerLimb`]: 1,
    [`${WP}PrimeDaikyuString`]: 1,
    [`${WP}PrimeDaikyuUpperLimb`]: 4,
    [`${WB}DualZorenPrimeBlueprint`]: 2,
    [`${WP}DualZorenPrimeHandle`]: 1,
    [`${WB}EpitaphPrimeBlueprint`]: 2,
    [`${WR}GyrePrimeChassisBlueprint`]: 1,
    [`${WR}GyrePrimeHelmetBlueprint`]: 1,
    [`${WP}KestrelPrimeGrip`]: 1,
    ...(JUDGMENT.partWithoutMasterableParentIsFree ? { [KAVASA_COLLAR_BP]: 1 } : {}),
    [`${WR}LavosPrimeSystemsBlueprint`]: 1,
    [`${WB}LexPrimeBlueprint`]: 2,
    [`${WP}LexPrimeReceiver`]: 2,
    [`${WR}MesaPrimeBlueprint`]: 1,
    [`${WR}MesaPrimeChassisComponent`]: 1,
    [`${WP}NautilusPrimeCarapace`]: 1,
    [`${WP}NautilusPrimeCerebrum`]: 1,
    [mixedPileSoldRow("NekrosPrimeSystems")]: 1,
    [mixedPileSoldRow("NyxPrimeChassis")]: 1,
    [`${WR}OberonPrimeChassisBlueprint`]: 1,
    [`${WP}OkinaPrimeBlade`]: 1,
    [`${WP}PrimePolearmBlade`]: 1,
    [`${WP}PangolinPrimeBlade`]: 1,
    [`${WP}PrimeBowUpperLimb`]: 2,
    [`${WB}PerigalePrimeBlueprint`]: 1,
    [`${WP}PerigalePrimeStock`]: 1,
    [`${WR}ProteaPrimeHelmetBlueprint`]: 1,
    [`${WR}ProteaPrimeSystemsBlueprint`]: 1,
    [`${WP}QuassusPrimeBlade`]: 1,
    [`${WR}RevenantPrimeBlueprint`]: 1,
    [`${WR}SarynPrimeBlueprint`]: 1,
    [`${WR}SevagothPrimeBlueprint`]: 1,
    [`${WP}ShadePrimeCerebrum`]: 1,
    [`${WP}ShadePrimeSystems`]: 1,
    [`${WR}StyanaxPrimeSystemsBlueprint`]: 1,
    [`${WR}TitaniaPrimeBlueprint`]: 1,
    [`${WR}TitaniaPrimeChassisBlueprint`]: 1,
    [`${WP}TrumnaPrimeBarrel`]: 3,
    [`${WP}TrumnaPrimeStock`]: 1,
    [`${WP}PrimeLightningGunBarrel`]: 1,
    [`${WP}PrimeLightningGunReceiver`]: 3,
    [`${WP}VentoPrimeHandle`]: 1,
    [`${WR}VorunaPrimeHelmetBlueprint`]: 1,
    [`${WR}YareliPrimeHelmetBlueprint`]: 3,
  };

  it("keeps Vauban Prime's chassis and systems blueprints", () => {
    const result = safeToSell(userInventory());
    expectKept(result, V_CHASSIS_BP);
    expectKept(result, V_SYSTEMS_BP);
    expectKept(result, V_HELMET);
  });

  it("lists exactly the prime parts safe to sell, with their sellable counts", () => {
    const result = safeToSell(userInventory());
    const sellable = Object.fromEntries([...result.shown].map(([key, row]) => [key, row.sellable]));
    expect(sellable).toEqual(EXPECTED);
  });

  it("offers the bulk sell queue the same counts", () => {
    const result = safeToSell(userInventory());
    const bulk = Object.fromEntries(
      [...result.everyRow]
        .filter(([, row]) => row.bulkSell > 0 && row.primeWithDucats)
        .map(([key, row]) => [key, row.bulkSell]),
    );
    expect(bulk).toEqual(EXPECTED);
  });
});
