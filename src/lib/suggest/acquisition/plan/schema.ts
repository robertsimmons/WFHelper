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

export interface PlanBadge {
  text: string;
  tone: PlanBadgeTone;
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

interface PlanCurrency {
  currency: string;
  /** Written the way it renders: "42", "141,000". */
  amount: string;
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

export interface PlanRow {
  /** Null for a single item; "150" or "1,200" for a quantity. */
  qty: string | null;
  label: string;
  note: string | null;
  alt: PlanAlt | null;
  /** Mock in the authored file: resolution recomputes it against inventory. */
  done: boolean;
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
}

/** A material the plan needs, placed by the resource store rather than by hand. */
export interface PlanMaterial {
  /** Written like a row quantity: "1,200". */
  qty: string;
  label: string;
  note: string | null;
}

export interface AuthoredPlan {
  name: string;
  kind: string;
  /** 1-10. */
  effort: number;
  tradeable: boolean | string | null;
  progress: PlanProgress;
  badges: PlanBadge[];
  prices: PlanPrice[];
  groups: PlanGroup[];
  materials?: PlanMaterial[];
}

export function altText(alt: PlanAlt): string {
  return typeof alt === "string" ? alt : alt.text;
}

export function altSpends(alt: PlanAlt): PlanCurrency[] {
  return typeof alt === "string" ? [] : alt.spends;
}
