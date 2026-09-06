import { buildSubsumedFamilySet, isFrameSubsumed, isSubsumableFrame } from "../../helminth.js";
import { buildOwnership, buildPartPlans, listFrames, ownsItem } from "./parts.js";
import { buildPaths } from "./paths.js";
import { createRatings } from "./ratings.js";
import type { ItemDbEntry } from "../../../types/inventory.js";
import type { AcquisitionContext, AcquisitionTarget, NeedReason, PartPlan } from "./types.js";

export type {
  AcquisitionContext,
  AcquisitionKind,
  AcquisitionPath,
  AcquisitionTarget,
  MaterialState,
  NeedReason,
  PartPlan,
  PartRole,
  PartState,
  PathCost,
  PathKind,
  PathStep,
  PlatCost,
  PlatPriceLookup,
  RelicCost,
  RelicHolding,
} from "./types.js";
export { createRatings, UNKNOWN_DIFFICULTY, type Ratings } from "./ratings.js";
export { curated, type CuratedEntry, type CuratedSource } from "./curated.js";
export { buildOwnership, isFrameEntry, listFrames } from "./parts.js";

const NO_PATH_EFFORT = 1;

const EMPTY_PLAN: PartPlan = {
  known: false,
  main: null,
  components: [],
  missing: [],
  materials: [],
  credits: 0,
  buildable: false,
};

function isPrimeEntry(name: string, entry: ItemDbEntry): boolean {
  return entry.isPrime === true || /\sprime$/i.test(name);
}

/** Owning it and subsuming it are separate wins, and each is its own reason to farm. */
function needsFor(owned: boolean, subsumable: boolean, subsumed: boolean): NeedReason[] {
  const needs: NeedReason[] = [];
  if (!owned) needs.push("mastery");
  if (subsumable && !subsumed) needs.push("subsume");
  return needs;
}

export function resolveAcquisition(ctx: AcquisitionContext): AcquisitionTarget[] {
  const itemDb = ctx.itemDb || {};
  const ownership = buildOwnership(ctx.inventory, itemDb);
  const subsumedFamilies = buildSubsumedFamilySet(ctx.inventory, itemDb);
  const ratings = createRatings(ctx.ratings);
  const only = ctx.only ? new Set(ctx.only.map((name) => name.toLowerCase())) : null;

  const wanted: Array<{
    uniqueName: string;
    name: string;
    entry: ItemDbEntry;
    needs: NeedReason[];
  }> = [];

  for (const frame of listFrames(itemDb)) {
    if (only && !only.has(frame.name.toLowerCase())) continue;
    const subsumable = isSubsumableFrame(frame.name);
    const subsumed = subsumable && isFrameSubsumed(frame.name, subsumedFamilies);
    const owned = ownsItem(frame.uniqueName, ownership) || subsumed;
    const needs = needsFor(owned, subsumable, subsumed);
    if (needs.length === 0) continue;
    wanted.push({ uniqueName: frame.uniqueName, name: frame.name, entry: frame.entry, needs });
  }

  const plans = buildPartPlans(wanted, itemDb, ownership);

  const targets = wanted.map((frame): AcquisitionTarget => {
    const parts = plans.get(frame.uniqueName) ?? EMPTY_PLAN;
    const isPrime = isPrimeEntry(frame.name, frame.entry);
    const paths = buildPaths({
      name: frame.name,
      isPrime,
      parts,
      inventory: ctx.inventory,
      relicDb: ctx.relicDb,
      plat: ctx.plat,
      ratings,
    });
    return {
      uniqueName: frame.uniqueName,
      name: frame.name,
      ...(frame.entry.displayName ? { displayName: frame.entry.displayName } : {}),
      imageUrl: frame.entry.imageUrl ?? null,
      kind: "warframe",
      isPrime,
      needs: frame.needs,
      parts,
      paths,
      difficulty: ratings.difficultyLabel(frame.name),
      rank: ratings.rank(frame.name),
      wiki: frame.entry.wikiaUrl ?? null,
      effort: paths[0]?.effort ?? NO_PATH_EFFORT,
    };
  });

  targets.sort((a, b) => a.effort - b.effort || a.name.localeCompare(b.name));
  return targets;
}
