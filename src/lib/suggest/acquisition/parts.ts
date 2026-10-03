import { aggregateComponentOwnership } from "../../../../config/shared/componentOwnership.js";
import {
  componentUniqueNameAliases,
  ownedComponentCount,
} from "../../../../config/shared/componentNames.js";
import {
  pendingRecipeCounts,
  withoutFoundryPending,
} from "../../../../config/shared/foundryPending.js";
import { buildCraftingTree, type CraftingTreeNode } from "../../craftingTree.js";
import { buildMasteryPlan, type PlannedItem, type PlannerPin } from "../../masteryPlanner.js";
import type { ItemDbEntry, RawInventoryData } from "../../../types/inventory.js";
import type { MessageKey } from "../../i18n.js";
import type {
  MaterialState,
  ModularGear,
  ModularHead,
  ModularPlan,
  PartPlan,
  PartState,
} from "./types.js";

const FRAME_PATH = /\/Powersuits\//i;

export function buildOwnership(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): Map<string, number> {
  const usable = withoutFoundryPending(
    (inventory ?? {}) as Record<string, unknown>,
    (uniqueName) => itemDb[uniqueName]?.reusableBlueprint === true,
  );
  return aggregateComponentOwnership(usable);
}

/** Product uniqueName -> builds the foundry holds for it, finished-but-unclaimed
 *  ones included. buildOwnership has already dropped the blueprints these spent,
 *  and the game took the ingredients when each build started. */
export function foundryBuilds(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): Map<string, number> {
  const builds = new Map<string, number>();
  for (const [blueprint, count] of pendingRecipeCounts(inventory?.PendingRecipes)) {
    const product = itemDb[blueprint]?.buildsProduct;
    if (product) builds.set(product, (builds.get(product) ?? 0) + count);
  }
  return builds;
}

export interface GearEntry {
  uniqueName: string;
  entry: ItemDbEntry;
  name: string;
}

/** Exalted weapons, Necramechs and Archwings share the Powersuits path, so the
 *  product category has to agree before a row counts as a Warframe. */
function isFrameEntry(uniqueName: string, entry: ItemDbEntry | undefined): boolean {
  if (!entry?.name) return false;
  if (entry.exalted === true || entry.isBuildComponent === true) return false;
  // Every augment mod lives under its frame's Powersuits path, and there are
  // more of those than there are frames.
  if (entry.masterable !== true) return false;
  const product = String(entry.productCategory ?? "");
  if (product) return product === "Suits";
  if (/^warframes?$/i.test(String(entry.category ?? ""))) return true;
  return FRAME_PATH.test(uniqueName);
}

const ARCHWING_PATH = /\/Archwing\//i;

/** The suit itself. Its guns and melee are weapons and are swept as such. */
function isArchwingEntry(uniqueName: string, entry: ItemDbEntry | undefined): boolean {
  if (!entry?.name) return false;
  if (entry.exalted === true || entry.isBuildComponent === true) return false;
  if (entry.masterable !== true) return false;
  const product = String(entry.productCategory ?? "");
  if (product) return product === "SpaceSuits";
  if (/^archwings?$/i.test(String(entry.category ?? ""))) return true;
  return ARCHWING_PATH.test(uniqueName) && FRAME_PATH.test(uniqueName);
}

const SENTINEL_PATH = /\/Sentinels\/SentinelPowersuits\//i;

/** The robot itself. Its gun is a weapon and is swept as one. */
function isSentinelEntry(uniqueName: string, entry: ItemDbEntry | undefined): boolean {
  if (!entry?.name) return false;
  if (entry.exalted === true || entry.isBuildComponent === true) return false;
  if (entry.masterable !== true) return false;
  const product = String(entry.productCategory ?? "");
  if (product) return product === "Sentinels";
  if (/^sentinels?$/i.test(String(entry.category ?? ""))) return true;
  return SENTINEL_PATH.test(uniqueName);
}

const BEAST_PATH = /\/(?:KubrowPet|CatbrowPet|CreaturePets)\//i;

/** Kubrows, Kavats, Predasites and Vulpaphylas, one row per subspecies. Their
 *  parts share the path and reach the export typed as pistols. */
function isBeastEntry(uniqueName: string, entry: ItemDbEntry | undefined): boolean {
  if (!entry?.name) return false;
  if (entry.exalted === true || entry.isBuildComponent === true) return false;
  if (entry.masterable !== true) return false;
  const product = String(entry.productCategory ?? "");
  if (product) return product === "KubrowPets";
  return BEAST_PATH.test(uniqueName);
}

const NECRAMECH_PATH = /\/EntratiMech\//i;

/** A Necramech is exported as a Warframe under a category of its own. */
function isNecramechEntry(uniqueName: string, entry: ItemDbEntry | undefined): boolean {
  if (!entry?.name) return false;
  if (entry.exalted === true || entry.isBuildComponent === true) return false;
  if (entry.masterable !== true) return false;
  const product = String(entry.productCategory ?? "");
  if (product) return product === "MechSuits";
  return NECRAMECH_PATH.test(uniqueName);
}

function listSuits(
  itemDb: Record<string, ItemDbEntry>,
  matches: (uniqueName: string, entry: ItemDbEntry | undefined) => boolean,
): GearEntry[] {
  const seen = new Set<string>();
  const out: GearEntry[] = [];
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    if (!matches(uniqueName, entry)) continue;
    const name = String(entry.name);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ uniqueName, entry, name });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function listFrames(itemDb: Record<string, ItemDbEntry>): GearEntry[] {
  return listSuits(itemDb, isFrameEntry);
}

export function listArchwings(itemDb: Record<string, ItemDbEntry>): GearEntry[] {
  return listSuits(itemDb, isArchwingEntry);
}

export function listSentinels(itemDb: Record<string, ItemDbEntry>): GearEntry[] {
  return listSuits(itemDb, isSentinelEntry);
}

export function listBeasts(itemDb: Record<string, ItemDbEntry>): GearEntry[] {
  return listSuits(itemDb, isBeastEntry);
}

export function listNecramechs(itemDb: Record<string, ItemDbEntry>): GearEntry[] {
  return listSuits(itemDb, isNecramechEntry);
}

export function ownsItem(uniqueName: string, ownership: Map<string, number>): boolean {
  return ownedComponentCount(uniqueName, ownership) > 0;
}

/** Mastery for modular gear comes from the head part alone; everything else
 *  fitted is stats and looks. An amp prism reaches the item database with no
 *  masterable flag, so the path is the one rule that classes them all. */
const MODULAR_HEAD_PATHS: Array<[RegExp, ModularGear]> = [
  [/\/MoaPets\/MoaPetParts\/MoaPetHead/i, "moa"],
  [/\/ZanukaPets\/ZanukaPetParts\/ZanukaPetPartHead/i, "hound"],
  [/\/OperatorAmplifiers?\/.*Barrel/i, "amp"],
  [/\/Hoverboard\/.*Deck$/i, "kdrive"],
  [/\/(?:SUModular\w*|InfKitGun)\/Barrels?\//i, "kitgun"],
  [/\/ModularMelee\w*\/Tips?\//i, "zaw"],
];

/** Conclave copies share the real part's name and are never built. */
const CONCLAVE_COPY = /\/PvPVariant/i;

interface ModularGearFacts {
  name: string;
  headLabelKey: MessageKey;
  requiresGilding: boolean;
  /** The other parts one build takes, one of each. */
  slots: readonly RegExp[];
}

const MODULAR_GEAR: Record<ModularGear, ModularGearFacts> = {
  moa: {
    name: "Moa",
    headLabelKey: "nextUp.modularHeadModels",
    requiresGilding: true,
    slots: [/\/MoaPetParts\/\w*Engine/i, /\/MoaPetParts\/\w*Leg/i, /\/MoaPetParts\/\w*Payload/i],
  },
  hound: {
    name: "Hound",
    headLabelKey: "nextUp.modularHeadModels",
    requiresGilding: true,
    slots: [/\/ZanukaPetPartBody/i, /\/ZanukaPetPartLegs/i, /\/ZanukaPetPartTail/i],
  },
  amp: {
    name: "Amp",
    headLabelKey: "nextUp.modularHeadPrisms",
    requiresGilding: true,
    slots: [/\/OperatorAmplifiers?\/.*Chassis/i, /\/OperatorAmplifiers?\/.*Grip/i],
  },
  kdrive: {
    name: "K-Drive",
    headLabelKey: "nextUp.modularHeadBoards",
    requiresGilding: false,
    slots: [/\/Hoverboard\/.*Engine$/i, /\/Hoverboard\/.*Front$/i, /\/Hoverboard\/.*Jet$/i],
  },
  kitgun: {
    name: "Kitgun",
    headLabelKey: "nextUp.modularHeadChambers",
    requiresGilding: true,
    slots: [/\/(?:SUModular\w*|InfKitGun)\/Handles?\//i, /\/(?:SUModular\w*|InfKitGun)\/Clips?\//i],
  },
  zaw: {
    name: "Zaw",
    headLabelKey: "nextUp.modularHeadStrikes",
    requiresGilding: true,
    slots: [/\/ModularMelee\w*\/Handles?\//i, /\/ModularMelee\w*\/Balance\//i],
  },
};

function modularSlots(itemDb: Record<string, ItemDbEntry>, slots: readonly RegExp[]): string[][] {
  const out: string[][] = slots.map(() => []);
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    if (!entry?.name || entry.isBuildComponent === true || entry.buildsProduct) continue;
    if (CONCLAVE_COPY.test(uniqueName)) continue;
    const index = slots.findIndex((pattern) => pattern.test(uniqueName));
    if (index >= 0) out[index]?.push(uniqueName);
  }
  return out;
}

export function modularGearOf(uniqueName: string): ModularGear | null {
  if (CONCLAVE_COPY.test(uniqueName)) return null;
  for (const [pattern, gear] of MODULAR_HEAD_PATHS) {
    if (pattern.test(uniqueName)) return gear;
  }
  return null;
}

interface ModularGearEntry {
  uniqueName: string;
  name: string;
  entry: ItemDbEntry;
  plan: ModularPlan;
}

/** DE stores a built MOA, Hound, amp, K-Drive, Kitgun or Zaw under a generic ItemType with
 *  the fitted parts listed beside it, so a head part never reaches the
 *  ownership map on its own. */
export function fittedModularParts(inventory: RawInventoryData | null): Set<string> {
  const fitted = new Set<string>();
  for (const slice of Object.values((inventory ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(slice)) continue;
    for (const row of slice) {
      const parts = (row as { ModularParts?: unknown })?.ModularParts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (typeof part === "string" && part) fitted.add(part);
      }
    }
  }
  return fitted;
}

/** One entry per gear type rather than per part, so the card can read
 *  "1 of 4 Models". */
export function listModularGear(
  itemDb: Record<string, ItemDbEntry>,
  ownsHead: (uniqueName: string, name: string) => boolean,
): ModularGearEntry[] {
  const heads = new Map<ModularGear, ModularHead[]>();
  const seen = new Set<string>();
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    if (!entry?.name || entry.exalted === true || entry.isBuildComponent === true) continue;
    const gear = modularGearOf(uniqueName);
    if (!gear) continue;
    const name = String(entry.name);
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    heads.set(gear, [
      ...(heads.get(gear) ?? []),
      {
        uniqueName,
        name,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
        imageUrl: entry.imageUrl ?? null,
        owned: ownsHead(uniqueName, name),
      },
    ]);
  }

  const out: ModularGearEntry[] = [];
  for (const [, gear] of MODULAR_HEAD_PATHS) {
    const rows = heads.get(gear);
    if (!rows?.length) continue;
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const facts = MODULAR_GEAR[gear];
    out.push({
      uniqueName: `modular:${gear}`,
      name: facts.name,
      entry: { name: facts.name, imageUrl: rows.find((row) => row.imageUrl)?.imageUrl ?? null },
      plan: {
        gear,
        headLabelKey: facts.headLabelKey,
        heads: rows,
        owned: rows.filter((row) => row.owned).length,
        requiresGilding: facts.requiresGilding,
        slots: modularSlots(itemDb, facts.slots),
      },
    });
  }
  return out;
}

const EMPTY_PLAN: PartPlan = {
  known: false,
  main: null,
  components: [],
  missing: [],
  materials: [],
  credits: 0,
  copies: 1,
  foundry: false,
  buildable: false,
};

function partState(
  component: PlannedItem["components"][number],
  role: PartState["role"],
  building: number,
): PartState {
  return {
    uniqueName: component.uniqueName,
    name: component.name,
    ...(component.displayName ? { displayName: component.displayName } : {}),
    role,
    required: component.needed,
    owned: component.owned,
    building,
    missing: component.missing,
  };
}

function materialState(resource: PlannedItem["resources"][number]): MaterialState {
  return {
    uniqueName: resource.uniqueName,
    name: resource.name,
    ...(resource.displayName ? { displayName: resource.displayName } : {}),
    required: resource.needed,
    owned: resource.owned,
    missing: resource.missing,
  };
}

function toPartPlan(
  planned: PlannedItem,
  copies: number,
  building: ReadonlyMap<string, number>,
  foundry: boolean,
): PartPlan {
  if (!planned.hasRecipe) return EMPTY_PLAN;
  const mainRow = planned.components.find((component) => component.isBlueprint) ?? null;
  const main = mainRow ? partState(mainRow, "main", 0) : null;
  const components = planned.components
    .filter((component) => !component.isBlueprint)
    .map((component) =>
      partState(
        component,
        "component",
        Math.min(component.owned, building.get(component.uniqueName) ?? 0),
      ),
    );
  const missing = [...(main ? [main] : []), ...components].filter((part) => part.missing > 0);
  // A part still in the foundry is held toward the plan but cannot go into a build yet.
  const inHand = components.every(
    (part) => part.owned - part.building >= Math.ceil(part.required / copies),
  );
  return {
    known: true,
    main,
    components,
    missing,
    materials: planned.resources.map(materialState),
    credits: planned.credits,
    copies,
    foundry,
    buildable: planned.craftableNow && inHand,
  };
}

/** A part's own blueprint is not the part. componentUniqueNameAliases reads
 *  ".../SpinnerexBlade" and ".../SpinnerexBladeBlueprint" as one pile in two
 *  spellings, which holds only for a part farmed whole: a Prime part reaches the
 *  inventory under the "...Blueprint" spelling and is consumed as it is. Where a
 *  recipe builds the part, the two are separate items, and letting the blueprint
 *  answer for the part tells the card the foundry would take a build it has no
 *  components for. Only the plan drops them - a bought blueprint is still a
 *  thing the player holds, which is what the vendor and Nightwave passes ask. */
function withoutPartBlueprints(
  ownership: Map<string, number>,
  itemDb: Record<string, ItemDbEntry>,
): Map<string, number> {
  const pool = new Map(ownership);
  for (const uniqueName of ownership.keys()) {
    const product = itemDb[uniqueName]?.buildsProduct;
    if (!product || product === uniqueName) continue;
    if (componentUniqueNameAliases(product).includes(uniqueName)) pool.delete(uniqueName);
  }
  return pool;
}

interface PartPlanTarget {
  uniqueName: string;
  name: string;
  entry: ItemDbEntry;
  /** Copies still to build, or null for gear only ever built once. Null and zero
   *  both size the plan at one build and leave the foundry out of it. */
  copies: number | null;
}

function planPins(
  targets: readonly PartPlanTarget[],
  itemDb: Record<string, ItemDbEntry>,
  held: Map<string, number>,
  building: ReadonlyMap<string, number>,
  foundry: boolean,
  out: Map<string, PartPlan>,
): void {
  const pins: PlannerPin[] = targets.map((target) => ({
    uniqueName: target.uniqueName,
    name: target.name,
    ...(target.entry.displayName ? { displayName: target.entry.displayName } : {}),
    imageUrl: target.entry.imageUrl ?? null,
    masteryXpRemaining: 0,
    copies: Math.max(1, target.copies ?? 1),
  }));
  const plan = buildMasteryPlan(pins, itemDb, held, { allocate: false });
  plan.items.forEach((item, index) => {
    out.set(item.uniqueName, toPartPlan(item, pins[index]?.copies ?? 1, building, foundry));
  });
}

const RECIPE_PATH = /\/Types\/Recipes\//i;

/** How many of each part, at every depth of the recipe, the plan's builds still
 *  need. A sub-assembly already built, or building where the plan counts the
 *  foundry, took its own parts with it, so a part inside it is needed only for
 *  the sub-assemblies still to make. Read against the pool the card reads. */
export function partDemand(
  uniqueName: string,
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
  parts: PartPlan,
): Map<string, number> {
  const pool = withoutPartBlueprints(buildOwnership(inventory, itemDb), itemDb);
  if (parts.foundry) {
    for (const [product, count] of foundryBuilds(inventory, itemDb)) {
      pool.set(product, (pool.get(product) ?? 0) + count);
    }
  }
  const demand = new Map<string, number>();
  const tree = buildCraftingTree(uniqueName, itemDb, pool, { count: parts.copies });
  if (!tree) return demand;

  // A part nothing still needs records a need of none rather than going missing.
  const walk = (node: CraftingTreeNode, needed: number, depth: number): void => {
    let remaining = needed;
    if (depth > 0) {
      if (!node.isBlueprintItem && !RECIPE_PATH.test(node.uniqueName)) return;
      demand.set(node.uniqueName, (demand.get(node.uniqueName) ?? 0) + needed);
      const owned = Math.min(ownedComponentCount(node.uniqueName, pool), remaining);
      for (const alias of componentUniqueNameAliases(node.uniqueName)) {
        const have = pool.get(alias);
        if (have !== undefined) pool.set(alias, Math.max(0, have - owned));
      }
      remaining -= owned;
    }
    const recipe = node.recipe;
    if (!recipe) return;
    const num = Math.max(1, recipe.num || 1);
    const fullRuns = Math.max(1, Math.ceil(node.count / num));
    const runs = remaining > 0 ? Math.ceil(remaining / num) : 0;
    for (const child of node.children) {
      if (child.isBlueprintItem)
        walk(child, recipe.reusableBlueprint ? Math.min(1, runs) : runs, depth + 1);
      else walk(child, Math.ceil((child.count * runs) / fullRuns), depth + 1);
    }
  };
  walk(tree, parts.copies, 0);
  return demand;
}

/** What `copies` builds cost from an empty account: the bill before any part is
 *  built, against which a part plan's own bill shows what built parts used up. */
export function startingBill(
  uniqueName: string,
  itemDb: Record<string, ItemDbEntry>,
  copies: number,
): { credits: number; materials: Map<string, number> } {
  const pin: PlannerPin = {
    uniqueName,
    name: String(itemDb[uniqueName]?.name ?? uniqueName),
    imageUrl: null,
    masteryXpRemaining: 0,
    copies,
  };
  const item = buildMasteryPlan([pin], itemDb, new Map(), { allocate: false }).items[0];
  const materials = new Map<string, number>();
  for (const resource of item?.resources ?? []) materials.set(resource.uniqueName, resource.needed);
  return { credits: item?.credits ?? 0, materials };
}

/** Every unbuilt target in the game. Allocation is off: a card answers for its
 *  own item, so what it says the player holds must not depend on which other
 *  targets happened to be swept alongside it. */
export function buildPartPlans(
  targets: readonly PartPlanTarget[],
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
  building: ReadonlyMap<string, number>,
): Map<string, PartPlan> {
  const pool = withoutPartBlueprints(ownership, itemDb);
  const withBuilding = new Map(pool);
  for (const [uniqueName, count] of building) {
    withBuilding.set(uniqueName, (withBuilding.get(uniqueName) ?? 0) + count);
  }
  const counted = (target: PartPlanTarget): boolean => (target.copies ?? 0) > 0;

  const out = new Map<string, PartPlan>();
  planPins(
    targets.filter((target) => !counted(target)),
    itemDb,
    pool,
    new Map(),
    false,
    out,
  );
  planPins(targets.filter(counted), itemDb, withBuilding, building, true, out);
  return out;
}
