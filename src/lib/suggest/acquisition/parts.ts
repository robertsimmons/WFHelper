import { aggregateComponentOwnership } from "../../../../config/shared/componentOwnership.js";
import {
  componentUniqueNameAliases,
  ownedComponentCount,
} from "../../../../config/shared/componentNames.js";
import { withoutFoundryPending } from "../../../../config/shared/foundryPending.js";
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
 *  masterable flag, so the path is the one rule that classes all four. */
const MODULAR_HEAD_PATHS: Array<[RegExp, ModularGear]> = [
  [/\/MoaPets\/MoaPetParts\/MoaPetHead/i, "moa"],
  [/\/ZanukaPets\/ZanukaPetParts\/ZanukaPetPartHead/i, "hound"],
  [/\/OperatorAmplifiers?\/.*Barrel/i, "amp"],
  [/\/Hoverboard\/.*Deck$/i, "kdrive"],
];

interface ModularGearFacts {
  name: string;
  headLabelKey: MessageKey;
  requiresGilding: boolean;
}

const MODULAR_GEAR: Record<ModularGear, ModularGearFacts> = {
  moa: { name: "Moa", headLabelKey: "nextUp.modularHeadModels", requiresGilding: true },
  hound: { name: "Hound", headLabelKey: "nextUp.modularHeadModels", requiresGilding: true },
  amp: { name: "Amp", headLabelKey: "nextUp.modularHeadPrisms", requiresGilding: true },
  kdrive: { name: "K-Drive", headLabelKey: "nextUp.modularHeadBoards", requiresGilding: false },
};

function modularGearOf(uniqueName: string): ModularGear | null {
  for (const [pattern, gear] of MODULAR_HEAD_PATHS) {
    if (pattern.test(uniqueName)) return gear;
  }
  return null;
}

export interface ModularGearEntry {
  uniqueName: string;
  name: string;
  entry: ItemDbEntry;
  plan: ModularPlan;
}

/** DE stores a built MOA, Hound, amp or K-Drive under a generic ItemType with
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
  buildable: false,
};

function partState(
  component: PlannedItem["components"][number],
  role: PartState["role"],
): PartState {
  return {
    uniqueName: component.uniqueName,
    name: component.name,
    ...(component.displayName ? { displayName: component.displayName } : {}),
    role,
    required: component.needed,
    owned: component.owned,
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

function toPartPlan(planned: PlannedItem): PartPlan {
  if (!planned.hasRecipe) return EMPTY_PLAN;
  const mainRow = planned.components.find((component) => component.isBlueprint) ?? null;
  const main = mainRow ? partState(mainRow, "main") : null;
  const components = planned.components
    .filter((component) => !component.isBlueprint)
    .map((component) => partState(component, "component"));
  const missing = [...(main ? [main] : []), ...components].filter((part) => part.missing > 0);
  return {
    known: true,
    main,
    components,
    missing,
    materials: planned.resources.map(materialState),
    credits: planned.credits,
    buildable: planned.craftableNow,
  };
}

/** What every unbuilt target the last sweep planned still calls for, summed
 *  recursively, by uniqueName. Null until a sweep has run, which is not the same
 *  as nothing needing anything. */
let resourceNeed: Map<string, number> | null = null;

export function unbuiltResourceNeed(): ReadonlyMap<string, number> | null {
  return resourceNeed;
}

/** The sweep is the only writer; a caller reaches for this to run the case where
 *  no sweep has happened yet. */
export function resetUnbuiltResourceNeedForTest(): void {
  resourceNeed = null;
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

/** One pass over every unbuilt target in the game. Allocation is off: a card
 *  answers for its own item, so what it says the player holds must not depend on
 *  which other targets happened to be swept alongside it. */
export function buildPartPlans(
  targets: readonly { uniqueName: string; name: string; entry: ItemDbEntry }[],
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): Map<string, PartPlan> {
  const pins: PlannerPin[] = targets.map((target) => ({
    uniqueName: target.uniqueName,
    name: target.name,
    ...(target.entry.displayName ? { displayName: target.entry.displayName } : {}),
    imageUrl: target.entry.imageUrl ?? null,
    masteryXpRemaining: 0,
  }));
  const plan = buildMasteryPlan(pins, itemDb, withoutPartBlueprints(ownership, itemDb), {
    allocate: false,
  });
  resourceNeed = new Map(plan.totals.map((row) => [row.uniqueName, row.needed]));
  const out = new Map<string, PartPlan>();
  for (const item of plan.items) out.set(item.uniqueName, toPartPlan(item));
  return out;
}
