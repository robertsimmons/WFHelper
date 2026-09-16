import type { ItemDbEntry, RawInventoryData } from "../../../../types/inventory.js";
import type { WorldState } from "../../../../types/world.js";
import type {
  PlanBadge,
  PlanDisclosure,
  PlanGroupType,
  PlanLiveState,
  PlanPrice,
} from "./schema.js";

/** A derived fact the plan page names. Each one either resolves against live app
 *  state or stays as the authored text, never dropped and never invented. */
export type PlanFactKind =
  | "fissure"
  | "bounty"
  | "varzia"
  | "standing"
  | "foundry"
  | "relics"
  | "overlay";

export interface ResolvedFact {
  kind: PlanFactKind;
  text: string;
  /** False when the app cannot compute this one today. */
  resolved: boolean;
}

export interface ResolvedQuantity {
  required: number;
  owned: number;
  remaining: number;
  /** What the row draws: what is left, or the full requirement once done. */
  text: string;
  requiredText: string;
  /** False when no inventory row answers this label, so `owned` is a floor. */
  tracked: boolean;
}

export interface ResolvedSpend {
  currency: string;
  amount: string;
  value: number;
}

export interface ResolvedAlt {
  text: string;
  /** Empty for an alt that costs nothing the ledger tracks. */
  spends: ResolvedSpend[];
  /** True when the player took this alternative instead of the row's own source. */
  taken: boolean;
}

/** Where a row's done flag came from. An untracked row falls back to the authored
 *  flag until the player ticks it. */
export type ResolvedDoneSource = "inventory" | "manual" | "authored";

export interface ResolvedRow {
  id: string;
  label: string;
  note: string | null;
  qty: ResolvedQuantity | null;
  alt: ResolvedAlt | null;
  done: boolean;
  source: ResolvedDoneSource;
  /** True when only the player can answer whether this is done. */
  manual: boolean;
}

export interface ResolvedLive {
  state: PlanLiveState;
  text: string;
  /** False when the authored text is shown as written. */
  resolved: boolean;
}

export interface ResolvedFlow {
  currency: string;
  /** What is still to bank or pay, formatted; the authored figure when settled. */
  amount: string;
  authoredAmount: string;
  value: number;
}

export interface ResolvedGroup {
  id: string;
  type: PlanGroupType;
  place: string;
  sub: string | null;
  activity: string | null;
  meta: string | null;
  mode: string | null;
  live: ResolvedLive | null;
  skip: { reason: string } | null;
  earns: ResolvedFlow | null;
  spends: ResolvedFlow[];
  map: string | null;
  /** Maps ship later; an absent one renders disabled rather than vanishing. */
  mapReady: boolean;
  rows: ResolvedRow[];
  conditions: string[];
  bonuses: string[];
  disclosures: PlanDisclosure[];
  facts: ResolvedFact[];
  done: boolean;
  /** Rows still to do; zero on a skipped group. */
  remaining: number;
}

export interface ResolvedLedgerEntry {
  currency: string;
  /** Null when no group banks it: a legal, unpaired spend. */
  earned: number | null;
  spent: number;
  /** What the outstanding groups still have to pay. */
  outstanding: number;
  paired: boolean;
}

export interface ResolvedProgress {
  have: number;
  need: number;
  unit: string;
  ready: boolean;
  /** False while the authored figures are shown as written. */
  resolved: boolean;
}

export interface ResolvedPlan {
  name: string;
  kind: string;
  /** Resolved live from the same source the card reads, never from the plan file. */
  tier: string | null;
  effort: number;
  tradeable: boolean | string | null;
  progress: ResolvedProgress;
  badges: PlanBadge[];
  prices: PlanPrice[];
  groups: ResolvedGroup[];
  ledger: ResolvedLedgerEntry[];
  steps: { done: number; total: number };
  /** False for a plan derived from the drop table alone, with no community notes. */
  authored: boolean;
  /** Fact kinds this plan wanted and the app could not compute. */
  unresolved: PlanFactKind[];
}

/** The real part count, handed in by whoever already holds it. The plan layer
 *  carries no part-name join of its own, so without this the header stays on the
 *  authored figures. */
export interface PlanProgressOverride {
  have: number;
  need: number;
  unit: string;
  ready: boolean;
}

export interface PlanContext {
  itemDb: Record<string, ItemDbEntry>;
  inventory: RawInventoryData | null;
  world?: WorldState | null | undefined;
  progress?: PlanProgressOverride | undefined;
  /** Row ids the player ticked by hand, for what inventory cannot see. */
  manualDone?: readonly string[] | undefined;
  /** Row ids the player cleared by hand, which outrank an authored done flag. */
  manualCleared?: readonly string[] | undefined;
  /** Row ids whose alt the player took, which is when its spends count. */
  altsTaken?: readonly string[] | undefined;
  /** Standing earned today against the daily cap, by currency name. */
  dailyStanding?: Readonly<Record<string, number>> | undefined;
  now?: number | undefined;
}
