/** The authored plan file, one per item. Every field here is written by hand and
 *  shipped as data; nothing in it is derived at runtime. */

export const PLAN_GROUP_TYPES = [
  "gate",
  "farm",
  "bounty",
  "boss",
  "vendor",
  "relics",
  "fissure",
  "currency",
  "research",
  "foundry",
  "craft",
] as const;

export type PlanGroupType = (typeof PLAN_GROUP_TYPES)[number];

/** The one repetitive grind the item mostly comes down to. */
export const PLAN_SOURCES = [
  "dojo",
  "bounties",
  "railjack",
  "boss",
  "duviri",
  "relics",
  "repeat",
  "standing",
  "shop",
  "unique",
] as const;

export type PlanSource = (typeof PLAN_SOURCES)[number];

/** The open worlds and landscapes a harvestable resource or a group can name. */
export const PLAN_MAP_KEYS = [
  "plains-of-eidolon",
  "orb-vallis",
  "cambion-drift",
  "duviri",
  "hollvania",
  "kullervos-hold",
  "archarbor",
] as const;

export const PLAN_LIVE_STATES = ["open", "blocked", "waiting"] as const;

export type PlanLiveState = (typeof PLAN_LIVE_STATES)[number];

export const PLAN_BADGE_TONES = ["circuit", "info", "warn"] as const;

export type PlanBadgeTone = (typeof PLAN_BADGE_TONES)[number];

interface PlanProgress {
  have: number;
  need: number;
  /** "parts", "Models", "relics": whatever the item is counted in. */
  unit: string;
}

/** A syndicate rank the player needs; `syndicate` is the rank table's name. */
export interface PlanRank {
  syndicate: string;
  level: number;
}

export interface PlanBadge {
  text: string;
  tone: PlanBadgeTone;
  /** A badge naming a rank stands down once the player holds it. */
  rank?: PlanRank | null;
}

export interface PlanPrice {
  label: string;
  amount: string;
  /** True only for a real-money bundle, which renders apart from time costs. */
  money: boolean;
}

interface PlanLive {
  state: PlanLiveState;
  text: string;
}

interface PlanSkip {
  reason: string;
}

export interface PlanCurrency {
  currency: string;
  /** Written the way it renders: "42", "141,000". */
  amount: string;
}

/** What buying something costs. `rank` is the rank the vendor wants first; a
 *  `reusable` blueprint is bought once and kept, so owning it settles the price.
 *  An `each` price is paid once per unit of the row's quantity; a `blueprint` price
 *  buys the blueprint the row's item is crafted from. */
export interface PlanPurchase {
  price: PlanCurrency[];
  rank?: PlanRank | null;
  reusable?: boolean;
  each?: boolean;
  blueprint?: boolean;
  /** Purchases a price makes when it is not per unit; one when absent. */
  count?: number;
}

export interface PlanDisclosure {
  title: string;
  body: string;
}

/** The pity purchase or second source for one row. The object form carries what
 *  taking it costs, which the plain string form leaves unpriced. */
type PlanAlt = string | PlanAltOffer;

interface PlanAltOffer {
  text: string;
  spends: PlanCurrency[];
}

/** The row's item is the free pick a rank-up grants. The group's spends leave its
 *  price out; it is owed only once the rank is held and the item is not. */
export interface PlanPick {
  rank: PlanRank;
  spends: PlanCurrency[];
}

export interface PlanRow {
  /** Null for a single item; "150" or "1,200" for a quantity. */
  qty: string | null;
  label: string;
  note: string | null;
  alt: PlanAlt | null;
  /** Mock in the authored file: resolution recomputes it against inventory. */
  done: boolean;
  /** The rank the row reaches, which is what marks it done. */
  rank?: PlanRank | null;
  pick?: PlanPick | null;
  /** What the row costs. A group's spends split across its rows by these. */
  buy?: PlanPurchase | null;
  /** A step only the player can answer; it names no item. */
  task?: boolean;
  /** The row counts built modular items holding any part the plan's rows name. */
  assembled?: boolean;
}

export interface PlanGroup {
  type: PlanGroupType;
  place: string;
  sub: string | null;
  activity: string | null;
  meta: string | null;
  mode: string | null;
  live: PlanLive | null;
  skip: PlanSkip | null;
  earns: PlanCurrency | null;
  spends: PlanCurrency[];
  map: string | null;
  rows: PlanRow[];
  conditions: string[];
  bonuses: string[];
  disclosures: PlanDisclosure[];
  /** A resource store entry whose tips this group carries, such as the standing
   *  currency a Simaris group earns. */
  ref?: string | null;
  /** The quest this group's one-time reward comes from. */
  quest?: string | null;
  /** What a set of two or more rows reads as, such as "Strike blueprints". */
  title?: string | null;
}

/** The route once the plan's quest is done and its reward is spent. */
export interface PlanAfterQuest {
  effort: number;
  badges: PlanBadge[];
  groups: PlanGroup[];
}

/** `chosen` is the route the groups walk; `afterQuest` is the one `afterQuest` walks. */
export const PLAN_ROUTE_ROLES = ["chosen", "afterQuest"] as const;

type PlanRouteRole = (typeof PLAN_ROUTE_ROLES)[number];

/** One in-game way to get the item, as the overview names it. */
interface PlanRoute {
  name: string;
  /** One line: what taking it costs. */
  cost: string;
  /** 1-10, on the same scale as the plan's. */
  effort: number;
  /** Null for an alternative the groups don't walk. */
  role: PlanRouteRole | null;
}

/** A material the plan needs, placed by the resource store rather than by hand. */
interface PlanMaterial {
  /** Written like a row quantity: "1,200". */
  qty: string;
  label: string;
  note: string | null;
}

export interface AuthoredPlan {
  name: string;
  kind: string;
  source: PlanSource;
  /** 1-10. */
  effort: number;
  tradeable: boolean | string | null;
  progress: PlanProgress;
  badges: PlanBadge[];
  prices: PlanPrice[];
  groups: PlanGroup[];
  materials?: PlanMaterial[];
  afterQuest?: PlanAfterQuest | null;
  routes?: PlanRoute[];
  /** The key of the shop file that sells the item's blueprints. */
  shop?: string;
  /** Each group opens the next, so the steps run in order and never share a trip. */
  sequence?: boolean;
}

export function altText(alt: PlanAlt): string {
  return typeof alt === "string" ? alt : alt.text;
}

export function altSpends(alt: PlanAlt): PlanCurrency[] {
  return typeof alt === "string" ? [] : alt.spends;
}
