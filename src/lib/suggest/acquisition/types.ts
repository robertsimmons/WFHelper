import type { ItemDbEntry, RawInventoryData } from "../../../types/inventory.js";
import type { RelicDatabase } from "../../../types/relics.js";
import type { NemesisProgenitor } from "./progenitors.js";

export type AcquisitionKind = "warframe" | "archwing" | "weapon";

/** Companion is the sentinel's gun, not the pet that carries it. */
export type WeaponClass = "primary" | "secondary" | "melee" | "archgun" | "archmelee" | "companion";

/** Owning it, feeding it to the Helminth, adapting it and priming it are four
 *  separate wins, and each one is its own reason to farm. */
export type NeedReason = "mastery" | "subsume" | "incarnon" | "prime";

export type NemesisFamily = "kuva" | "tenet" | "coda";

/** Percentage window the weapon's elemental bonus rolls in. */
export interface NemesisBonusRange {
  min: number;
  max: number;
}

export interface NemesisPlan {
  family: NemesisFamily;
  /** Quests and ranks gating the system; empty when nothing named them. */
  requires: string[];
  /** Where the candidate that becomes the nemesis is found; null when unknown. */
  spawn: string | null;
  /** Progenitor elements the family can roll; empty when nothing listed them. */
  elements: string[];
  /** Which Warframe rolls which element; empty for a family with no progenitor. */
  progenitors: NemesisProgenitor[];
  /** Null when nothing has stated the window; never a guess. */
  bonus: NemesisBonusRange | null;
  /** A repeat kill raises the bonus by valence fusion rather than adding a copy. */
  valenceFusion: boolean;
}

export interface IncarnonInfo {
  tier: string | null;
  upgradePath: string | null;
  /** Steel Path Circuit rotation week offering the adapter; null when unknown. */
  week: number | null;
  owned: boolean;
}

/** The item's own blueprint comes from somewhere else than its component ones. */
type PartRole = "main" | "component";

export type PathKind =
  | "market"
  | "trade"
  | "lab"
  | "junction"
  | "quest"
  | "boss"
  | "mission"
  | "bounty"
  | "vendor"
  | "relics"
  | "circuit"
  | "nemesis";

export interface PartState {
  uniqueName: string;
  name: string;
  displayName?: string | undefined;
  role: PartRole;
  required: number;
  owned: number;
  missing: number;
}

export interface MaterialState {
  uniqueName: string;
  name: string;
  displayName?: string | undefined;
  required: number;
  owned: number;
  missing: number;
}

export interface PartPlan {
  /** False when the item DB has no recipe to walk; every list is then empty. */
  known: boolean;
  main: PartState | null;
  components: PartState[];
  /** Every part still short, the main blueprint included. */
  missing: PartState[];
  materials: MaterialState[];
  /** Foundry bill for the whole build, component recipes included. */
  credits: number;
  buildable: boolean;
}

export interface PathStep {
  kind: PathKind;
  /** English location text, straight out of the curated table. */
  where: string;
  /** Names of the parts this step yields; empty means the whole item. */
  parts: string[];
}

export interface PlatCost {
  /** The whole set, where the market prices it. */
  set: number | null;
  parts: { name: string; plat: number | null }[];
  /** Sum of the part rows; null while any one of them is unpriced. */
  partsTotal: number | null;
}

export interface RelicHolding {
  relic: string;
  part: string;
  held: number;
}

export interface RelicCost {
  /** False when no relic database was handed over; held is then meaningless. */
  known: boolean;
  held: number;
  needed: number;
  rows: RelicHolding[];
}

export interface PathCost {
  /** Credits the path itself asks for, before the foundry bill. */
  credits: number | null;
  plat: PlatCost | null;
  relics: RelicCost | null;
}

export interface AcquisitionPath {
  id: string;
  kind: PathKind;
  /** Which of the still-missing parts this path can supply. */
  covers: string[];
  complete: boolean;
  steps: PathStep[];
  cost: PathCost;
  /** 0 trivial .. 1 grim. The path list sorts ascending on it. */
  effort: number;
}

export interface AcquisitionTarget {
  uniqueName: string;
  name: string;
  displayName?: string | undefined;
  imageUrl: string | null;
  kind: AcquisitionKind;
  /** Null for a Warframe or an Archwing suit. */
  weaponClass: WeaponClass | null;
  isPrime: boolean;
  /** Set only for a weapon a nemesis carries; the path is then a nemesis run. */
  nemesis: NemesisPlan | null;
  /** Set only for a weapon with a known Incarnon Genesis adapter. */
  incarnon: IncarnonInfo | null;
  /** Never empty: a target with nothing left to win is not returned at all. */
  needs: NeedReason[];
  parts: PartPlan;
  paths: AcquisitionPath[];
  /** Curated or supplied difficulty word; null when nothing has rated it. */
  difficulty: string | null;
  /** Supplied power/popularity tier; null is unknown, never bad. */
  tier: string | null;
  wiki: string | null;
  /** Effort of the easiest path, or 1 when no path is known. */
  effort: number;
}

/** Median plat for a market name; null for anything the cache cannot price. */
export type PlatPriceLookup = (name: string) => number | null;

export interface AcquisitionContext {
  itemDb: Record<string, ItemDbEntry>;
  inventory: RawInventoryData | null;
  /** Prime parts come out of relics; absent leaves the path unpriced, not hidden. */
  relicDb?: RelicDatabase | null | undefined;
  plat?: PlatPriceLookup | null | undefined;
  /** Farm-difficulty and power tables shipped later; read defensively. */
  ratings?: unknown;
  /** Weapon sources, same shape as the shipped frame table plus an optional
   *  `nemesis` block. Shipped later; read defensively. */
  curatedWeapons?: unknown;
  /** Restricts the sweep to these item names; every target otherwise. */
  only?: readonly string[] | undefined;
  /** Restricts the sweep to these kinds; every one of them otherwise. */
  kinds?: readonly AcquisitionKind[] | undefined;
}
