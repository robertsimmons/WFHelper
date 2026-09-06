import type { ItemDbEntry, RawInventoryData } from "../../../types/inventory.js";
import type { RelicDatabase } from "../../../types/relics.js";

export type AcquisitionKind = "warframe" | "weapon";

/** Owning it and having fed it to the Helminth are separate wins. */
export type NeedReason = "mastery" | "subsume";

/** The item's own blueprint comes from somewhere else than its component ones. */
export type PartRole = "main" | "component";

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
  isPrime: boolean;
  /** Never empty: a target with nothing left to win is not returned at all. */
  needs: NeedReason[];
  parts: PartPlan;
  paths: AcquisitionPath[];
  /** Curated or supplied difficulty word; null when nothing has rated it. */
  difficulty: string | null;
  /** Supplied power/popularity tier; null is unknown, never bad. */
  rank: string | null;
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
  /** Restricts the sweep to these item names; every frame otherwise. */
  only?: readonly string[] | undefined;
}
