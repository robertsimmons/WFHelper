import type { ItemDbEntry, MasteryData, RawInventoryData } from "../../../../types/inventory.js";
import type { RelicDatabase } from "../../../../types/relics.js";
import type { WorldState } from "../../../../types/world.js";
import type { ResourceLookup } from "./resources.js";
import type { PlanShop } from "./shop.js";
import type { ItemTip, TipsLookup } from "../tips/data.js";
import type { NeedReason } from "../types.js";
import type {
  PlanBadge,
  PlanDisclosure,
  PlanGroupType,
  PlanLiveState,
  PlanPrice,
  PlanRank,
  PlanSource,
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

interface ResolvedQuantity {
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

interface ResolvedAlt {
  text: string;
  /** Empty for an alt that costs nothing the ledger tracks. */
  spends: ResolvedSpend[];
  /** True when the player took this alternative instead of the row's own source. */
  taken: boolean;
}

/** `ahead` is a rank still to reach, `spent` a rank held without the item, and
 *  `unknown` a payload with no standing, which reads like `ahead`. */
type ResolvedPickState = "ahead" | "spent" | "unknown";

export interface ResolvedPick {
  state: ResolvedPickState;
  /** The rank's title, such as "Whozit". */
  rank: string;
  /** What buying it costs; owed only while `spent`. */
  spends: ResolvedSpend[];
}

export interface ResolvedPurchase {
  /** One purchase's price; an `each` price is paid per unit of the row. */
  price: ResolvedSpend[];
  each: boolean;
  /** The title of the rank the vendor wants, such as "Outworlder"; null for none. */
  rank: string | null;
  /** Null when the payload carries no standing to answer it. */
  rankMet: boolean | null;
  /** The price buys the blueprint the row's item is crafted from. */
  blueprint: boolean;
  reusable: boolean;
  /** A reusable blueprint the player already holds, so nothing is left to pay. */
  owned: boolean;
}

/** Where a row's done flag came from. An untracked row falls back to the authored
 *  flag until the player ticks it. */
type ResolvedDoneSource = "inventory" | "manual" | "authored";

export interface ResolvedRow {
  id: string;
  label: string;
  note: string | null;
  qty: ResolvedQuantity | null;
  alt: ResolvedAlt | null;
  /** Absent on a row no rank-up pick covers, and on a done row. */
  pick?: ResolvedPick | undefined;
  /** Absent on a row nothing is bought for. */
  purchase?: ResolvedPurchase | undefined;
  done: boolean;
  source: ResolvedDoneSource;
  /** True when only the player can answer whether this is done. */
  manual: boolean;
  /** What the ledger still owes for this row while it is open; absent is nothing. */
  owes?: ResolvedOwed[] | undefined;
  /** A common resource the store marks, which folds into the Basics line. */
  common?: boolean | undefined;
  /** Where else the resource store says the row's resource comes from. */
  other?: string[] | undefined;
  /** On a rank-up, the purchases it is climbed for; done once they all are. */
  unlocks?: string[] | undefined;
  /** The rank the row reaches. */
  rank?: PlanRank | undefined;
  /** A step only the player can answer; it names no item. */
  task?: boolean | undefined;
  /** The row names a currency or a standing, not an item. */
  currency?: boolean | undefined;
  /** On an item a rank-up sacrifices, the rank-up row that takes it. */
  paidAt?: string | undefined;
  /** On a material the foundry makes from its recipe. */
  craft?: ResolvedCraft | undefined;
  /** On a material the store says a quest hands over: its blueprint when crafted. */
  quest?: ResolvedQuest | undefined;
}

export interface ResolvedQuest {
  name: string;
  /** Null where the item database names no such quest. */
  done: boolean | null;
}

export interface ResolvedCraft {
  verb: "refine" | "build";
  /** Blueprints still to find and how many are held; null where a purchase buys it. */
  blueprints: { need: number; held: number | null } | null;
}

/** An amount still to pay, keyed by the ledger's name for the currency. */
export interface ResolvedOwed {
  currency: string;
  value: number;
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
  /** The ledger's name for the currency, and the figure the flow falls back to
   *  once nothing is outstanding. */
  ledger?: string | undefined;
  full?: number | undefined;
  /** The standing the player already holds; absent for a currency no balance answers. */
  held?: number | undefined;
}

export interface ResolvedGroup {
  id: string;
  type: PlanGroupType;
  place: string;
  sub: string | null;
  activity: string | null;
  title?: string | null | undefined;
  meta: string | null;
  mode: string | null;
  live: ResolvedLive | null;
  skip: { reason: string } | null;
  earns: ResolvedFlow | null;
  spends: ResolvedFlow[];
  map: string | null;
  /** A map not shipped yet renders disabled rather than vanishing. */
  mapReady: boolean;
  rows: ResolvedRow[];
  conditions: string[];
  bonuses: string[];
  disclosures: PlanDisclosure[];
  /** Community tips about this step, strongest first. */
  tips: ItemTip[];
  facts: ResolvedFact[];
  /** The quest whose one-time reward the group hands over. */
  quest?: string | null | undefined;
  done: boolean;
  /** On a currency group, the rows its own currency buys; done once they all are. */
  buys?: string[] | undefined;
  /** Rows still to do; zero on a done group. */
  remaining: number;
  /** What the ledger owes for the group as a whole while it is open, where its
   *  spend does not split across its rows. */
  owes?: ResolvedOwed[] | undefined;
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

export interface ResolvedRoute {
  name: string;
  cost: string;
  effort: number;
  /** The route the groups below walk for this player. */
  current: boolean;
  /** Its one-time quest reward is already paid out. */
  ruledOut: boolean;
}

interface ResolvedProgress {
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
  source: PlanSource;
  /** Resolved live from the same source the card reads, never from the plan file. */
  tier: string | null;
  effort: number;
  tradeable: boolean | string | null;
  progress: ResolvedProgress;
  badges: PlanBadge[];
  /** The rating of the route left once the plan's quest has paid out; null
   *  while the quest is still to do or its state is unknown. */
  afterQuest: { effort: number; badges: PlanBadge[] } | null;
  routes: ResolvedRoute[];
  prices: PlanPrice[];
  groups: ResolvedGroup[];
  /** Tips whose step this plan does not have, strongest first. */
  tips: ItemTip[];
  sentiment: ItemTip[];
  ledger: ResolvedLedgerEntry[];
  /** Builds the card counts: two for a Warframe both kept and subsumed. */
  copies: number;
  /** The items the plan's build steps make, which the build totals read. */
  builds: string[];
  /** Why the card wants the item, when the card says. */
  needs?: readonly NeedReason[] | undefined;
  shop: PlanShop | null;
  sequence: boolean;
  steps: { done: number; total: number };
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
  /** What sizes the builds a shared shop's other items still owe. */
  mastery?: MasteryData | null | undefined;
  world?: WorldState | null | undefined;
  /** What a generated Prime plan reads; without it only authored plans resolve. */
  relicDb?: RelicDatabase | null | undefined;
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
  /** The resource store plan materials resolve against; the shipped one by default. */
  resources?: ResourceLookup | undefined;
  /** The tips layer; the shipped one by default. */
  tips?: TipsLookup | undefined;
  /** Per shop key, the unit ids the player flipped away from their default pick. */
  shopPicks?: Readonly<Record<string, readonly string[]>> | undefined;
}
