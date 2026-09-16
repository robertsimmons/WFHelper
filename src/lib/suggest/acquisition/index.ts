import { buildSubsumedFamilySet, isFrameSubsumed, isSubsumableFrame } from "../../helminth.js";
import { createMasteryLookup } from "../masteryRoster.js";
import { createCurated, curated, mergeCurated, type CuratedSource } from "./curated.js";
import { createIncarnonLookup } from "./incarnon.js";
import { ergoGlastSource, nemesisPlan } from "./nemesis.js";
import {
  buildOwnership,
  buildPartPlans,
  fittedModularParts,
  listArchwings,
  listBeasts,
  listFrames,
  listModularGear,
  listNecramechs,
  listSentinels,
  ownsItem,
  type GearEntry,
} from "./parts.js";
import { buildPaths } from "./paths.js";
import { createRatings } from "./ratings.js";
import { baseWeaponName, listWeapons } from "./weapons.js";
import type { ItemDbEntry } from "../../../types/inventory.js";
import type {
  AcquisitionContext,
  AcquisitionKind,
  AcquisitionTarget,
  IncarnonInfo,
  ModularPlan,
  NeedReason,
  NemesisPlan,
  PartPlan,
  WeaponClass,
} from "./types.js";

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

/** Every kind whose whole recipe hangs off one item database row, so the sweep
 *  is the same walk for all of them. */
const PLAIN_KINDS: ReadonlyArray<
  readonly [AcquisitionKind, (itemDb: Record<string, ItemDbEntry>) => GearEntry[]]
> = [
  ["archwing", listArchwings],
  ["sentinel", listSentinels],
  ["beast", listBeasts],
  ["necramech", listNecramechs],
];

interface Wanted {
  uniqueName: string;
  name: string;
  entry: ItemDbEntry;
  kind: AcquisitionKind;
  weaponClass: WeaponClass | null;
  modular: ModularPlan | null;
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
  const isMastered = createMasteryLookup(ctx.mastery);
  const fitted = fittedModularParts(ctx.inventory);
  const isFinished = (uniqueName: string, name: string): boolean =>
    ownsItem(uniqueName, ownership) || fitted.has(uniqueName) || isMastered(uniqueName, name);
  const only = ctx.only ? new Set(ctx.only.map((name) => name.toLowerCase())) : null;
  const kinds = ctx.kinds ? new Set(ctx.kinds) : null;

  const wanted: Wanted[] = [];

  if (!kinds || kinds.has("warframe")) {
    for (const frame of listFrames(itemDb)) {
      if (only && !only.has(frame.name.toLowerCase())) continue;
      const subsumable = isSubsumableFrame(frame.name);
      const subsumed = subsumable && isFrameSubsumed(frame.name, subsumedFamilies);
      // A mastered frame that was sold still owes its subsume, so the mastery
      // reason goes and the subsume one stays.
      const owned =
        ownsItem(frame.uniqueName, ownership) ||
        subsumed ||
        isMastered(frame.uniqueName, frame.name);
      const needs = frameNeeds(owned, subsumable, subsumed);
      if (needs.length === 0) continue;
      wanted.push({
        uniqueName: frame.uniqueName,
        name: frame.name,
        entry: frame.entry,
        kind: "warframe",
        weaponClass: null,
        modular: null,
        needs,
        nemesis: null,
        incarnon: null,
        extraSources: [],
        build: true,
      });
    }
  }

  for (const [kind, list] of PLAIN_KINDS) {
    if (kinds && !kinds.has(kind)) continue;
    for (const gear of list(itemDb)) {
      if (only && !only.has(gear.name.toLowerCase())) continue;
      if (isFinished(gear.uniqueName, gear.name)) continue;
      wanted.push({
        uniqueName: gear.uniqueName,
        name: gear.name,
        entry: gear.entry,
        kind,
        weaponClass: null,
        modular: null,
        needs: ["mastery"],
        nemesis: null,
        incarnon: null,
        extraSources: [],
        build: true,
      });
    }
  }

  if (!kinds || kinds.has("modular")) {
    for (const gear of listModularGear(itemDb, isFinished)) {
      if (only && !only.has(gear.name.toLowerCase())) continue;
      if (gear.plan.owned === gear.plan.heads.length) continue;
      wanted.push({
        uniqueName: gear.uniqueName,
        name: gear.name,
        entry: gear.entry,
        kind: "modular",
        weaponClass: null,
        modular: gear.plan,
        needs: ["mastery"],
        nemesis: null,
        incarnon: null,
        extraSources: [],
        // Each head part carries its own recipe; the type itself has none.
        build: false,
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
      // Mastery is banked for good, so a weapon the roster has finished is not
      // a farm any more even once it has been sold or dissolved.
      const masteryDone = owned || isMastered(weapon.uniqueName, weapon.name);
      const needs = weaponNeeds(masteryDone, incarnon, primeUpgrade);
      if (needs.length === 0) continue;
      const glast = ergoGlastSource(weapon.name, weapon.weaponClass);
      wanted.push({
        uniqueName: weapon.uniqueName,
        name: weapon.name,
        entry: weapon.entry,
        kind: "weapon",
        weaponClass: weapon.weaponClass,
        modular: null,
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
      modular: item.modular,
      isPrime,
      nemesis: item.nemesis,
      incarnon: item.incarnon,
      needs: item.needs,
      parts,
      paths,
      difficulty: ratings.effortLabel(item.name),
      tier: ratings.tier(item.name),
      wiki: item.entry.wikiaUrl ?? null,
      effort: paths[0]?.effort ?? NO_PATH_EFFORT,
    };
  });

  targets.sort((a, b) => a.effort - b.effort || a.name.localeCompare(b.name));
  return targets;
}
