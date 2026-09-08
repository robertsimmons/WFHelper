import { aggregateComponentOwnership } from "../../../../config/shared/componentOwnership.js";
import { ownedComponentCount } from "../../../../config/shared/componentNames.js";
import { withoutFoundryPending } from "../../../../config/shared/foundryPending.js";
import { buildMasteryPlan, type PlannedItem, type PlannerPin } from "../../masteryPlanner.js";
import type { ItemDbEntry, RawInventoryData } from "../../../types/inventory.js";
import type { MaterialState, PartPlan, PartState } from "./types.js";

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

interface FrameEntry {
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

function listSuits(
  itemDb: Record<string, ItemDbEntry>,
  matches: (uniqueName: string, entry: ItemDbEntry | undefined) => boolean,
): FrameEntry[] {
  const seen = new Set<string>();
  const out: FrameEntry[] = [];
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

export function listFrames(itemDb: Record<string, ItemDbEntry>): FrameEntry[] {
  return listSuits(itemDb, isFrameEntry);
}

export function listArchwings(itemDb: Record<string, ItemDbEntry>): FrameEntry[] {
  return listSuits(itemDb, isArchwingEntry);
}

export function ownsItem(uniqueName: string, ownership: Map<string, number>): boolean {
  return ownedComponentCount(uniqueName, ownership) > 0;
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

/** One pass over every target, so a single spare part cannot complete two of them. */
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
  const plan = buildMasteryPlan(pins, itemDb, ownership);
  resourceNeed = new Map(plan.totals.map((row) => [row.uniqueName, row.needed]));
  const out = new Map<string, PartPlan>();
  for (const item of plan.items) out.set(item.uniqueName, toPartPlan(item));
  return out;
}
