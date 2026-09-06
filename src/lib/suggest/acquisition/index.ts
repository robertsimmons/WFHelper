import { buildSubsumedFamilySet, isFrameSubsumed, isSubsumableFrame } from "../../helminth.js";
import { createCurated, curated, mergeCurated, type CuratedSource } from "./curated.js";
import { createIncarnonLookup } from "./incarnon.js";
import { ergoGlastSource, nemesisPlan } from "./nemesis.js";
import { buildOwnership, buildPartPlans, listFrames, ownsItem } from "./parts.js";
import { buildPaths } from "./paths.js";
import { createRatings } from "./ratings.js";
import { baseWeaponName, listWeapons } from "./weapons.js";
import type { ItemDbEntry } from "../../../types/inventory.js";
import type {
  AcquisitionContext,
  AcquisitionKind,
  AcquisitionTarget,
  IncarnonInfo,
  NeedReason,
  NemesisPlan,
  PartPlan,
  WeaponClass,
} from "./types.js";

export type {
  AcquisitionContext,
  AcquisitionKind,
  AcquisitionPath,
  AcquisitionTarget,
  IncarnonInfo,
  MaterialState,
  NeedReason,
  NemesisBonusRange,
  NemesisFamily,
  NemesisPlan,
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
  WeaponClass,
} from "./types.js";
export { createRatings, UNKNOWN_DIFFICULTY, type Ratings } from "./ratings.js";
export {
  createCurated,
  curated,
  type CuratedEntry,
  type CuratedNemesis,
  type CuratedSource,
} from "./curated.js";
export { buildOwnership, isFrameEntry, listFrames } from "./parts.js";
export { isWeaponEntry, listWeapons, weaponClass } from "./weapons.js";
export { nemesisFamily } from "./nemesis.js";

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
function frameNeeds(owned: boolean, subsumable: boolean, subsumed: boolean): NeedReason[] {
  const needs: NeedReason[] = [];
  if (!owned) needs.push("mastery");
  if (subsumable && !subsumed) needs.push("subsume");
  return needs;
}

/** A Prime whose base the player already runs is an upgrade, not just mastery,
 *  and an Incarnon adapter is a win the weapon itself never grants. */
function weaponNeeds(
  owned: boolean,
  incarnon: IncarnonInfo | null,
  primeUpgrade: boolean,
): NeedReason[] {
  const needs: NeedReason[] = [];
  if (!owned) needs.push("mastery");
  if (primeUpgrade) needs.push("prime");
  if (incarnon && !incarnon.owned) needs.push("incarnon");
  return needs;
}

interface Wanted {
  uniqueName: string;
  name: string;
  entry: ItemDbEntry;
  kind: AcquisitionKind;
  weaponClass: WeaponClass | null;
  needs: NeedReason[];
  nemesis: NemesisPlan | null;
  incarnon: IncarnonInfo | null;
  extraSources: CuratedSource[];
  /** False when there is nothing to build: the gear is already in hand. */
  build: boolean;
}

export function resolveAcquisition(ctx: AcquisitionContext): AcquisitionTarget[] {
  const itemDb = ctx.itemDb || {};
  const ownership = buildOwnership(ctx.inventory, itemDb);
  const subsumedFamilies = buildSubsumedFamilySet(ctx.inventory, itemDb);
  const weaponCurated = createCurated(ctx.curatedWeapons);
  const lookup = mergeCurated(weaponCurated, curated);
  const ratings = createRatings(ctx.ratings, lookup);
  const incarnonFor = createIncarnonLookup(ctx.inventory, itemDb);
  const only = ctx.only ? new Set(ctx.only.map((name) => name.toLowerCase())) : null;
  const kinds = ctx.kinds ? new Set(ctx.kinds) : null;

  const wanted: Wanted[] = [];

  if (!kinds || kinds.has("warframe")) {
    for (const frame of listFrames(itemDb)) {
      if (only && !only.has(frame.name.toLowerCase())) continue;
      const subsumable = isSubsumableFrame(frame.name);
      const subsumed = subsumable && isFrameSubsumed(frame.name, subsumedFamilies);
      const owned = ownsItem(frame.uniqueName, ownership) || subsumed;
      const needs = frameNeeds(owned, subsumable, subsumed);
      if (needs.length === 0) continue;
      wanted.push({
        uniqueName: frame.uniqueName,
        name: frame.name,
        entry: frame.entry,
        kind: "warframe",
        weaponClass: null,
        needs,
        nemesis: null,
        incarnon: null,
        extraSources: [],
        build: true,
      });
    }
  }

  if (!kinds || kinds.has("weapon")) {
    const weapons = listWeapons(itemDb);
    const ownedByName = new Map<string, boolean>();
    for (const weapon of weapons) {
      ownedByName.set(weapon.name.toLowerCase(), ownsItem(weapon.uniqueName, ownership));
    }
    for (const weapon of weapons) {
      if (only && !only.has(weapon.name.toLowerCase())) continue;
      const owned = ownedByName.get(weapon.name.toLowerCase()) === true;
      const incarnon = incarnonFor(weapon.name);
      const base = baseWeaponName(weapon.name);
      const primeUpgrade = !owned && base !== null && ownedByName.get(base.toLowerCase()) === true;
      const needs = weaponNeeds(owned, incarnon, primeUpgrade);
      if (needs.length === 0) continue;
      const glast = ergoGlastSource(weapon.name, weapon.weaponClass);
      wanted.push({
        uniqueName: weapon.uniqueName,
        name: weapon.name,
        entry: weapon.entry,
        kind: "weapon",
        weaponClass: weapon.weaponClass,
        needs,
        nemesis: nemesisPlan(
          weapon.name,
          weapon.weaponClass,
          weaponCurated(weapon.name).nemesis ?? null,
        ),
        incarnon,
        extraSources: glast ? [{ kind: "vendor", parts: "both", where: glast }] : [],
        build: !owned,
      });
    }
  }

  const plans = buildPartPlans(
    wanted.filter((item) => item.build),
    itemDb,
    ownership,
  );

  const targets = wanted.map((item): AcquisitionTarget => {
    const parts = (item.build ? plans.get(item.uniqueName) : null) ?? EMPTY_PLAN;
    const isPrime = isPrimeEntry(item.name, item.entry);
    const paths = buildPaths({
      name: item.name,
      isPrime,
      parts,
      inventory: ctx.inventory,
      relicDb: ctx.relicDb,
      plat: ctx.plat,
      ratings,
      wanted: item.needs.includes("mastery"),
      curated: lookup,
      extraSources: item.extraSources,
      nemesis: item.nemesis,
      incarnon: item.incarnon,
    });
    return {
      uniqueName: item.uniqueName,
      name: item.name,
      ...(item.entry.displayName ? { displayName: item.entry.displayName } : {}),
      imageUrl: item.entry.imageUrl ?? null,
      kind: item.kind,
      weaponClass: item.weaponClass,
      isPrime,
      nemesis: item.nemesis,
      incarnon: item.incarnon,
      needs: item.needs,
      parts,
      paths,
      difficulty: ratings.difficultyLabel(item.name),
      rank: ratings.rank(item.name),
      wiki: item.entry.wikiaUrl ?? null,
      effort: paths[0]?.effort ?? NO_PATH_EFFORT,
    };
  });

  targets.sort((a, b) => a.effort - b.effort || a.name.localeCompare(b.name));
  return targets;
}
