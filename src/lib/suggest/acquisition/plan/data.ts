import { activeWindow } from "../../../format.js";
import { generatePrimePlan, type PrimeTarget } from "./prime.js";
import { rankMet } from "./ranks.js";
import { questDoneForLabel, type QuestState } from "./state.js";
import type { AuthoredPlan, PlanAfterQuest, PlanBadge, PlanSource } from "./schema.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../types/inventory.js";
import type { RelicDatabase } from "../../../../types/relics.js";
import type { VaultTrader, WorldState } from "../../../../types/world.js";
import type { AcquisitionKind, PartPlan, WeaponClass } from "../types.js";

const loaded = import.meta.glob("../../../../data/suggest/acquisitionPlans/plan-*.json", {
  eager: true,
});

/** Plans are hand-authored data files. The glob keeps adding one to the shipped
 * catalog to a single-file change, while its sorted order stays deterministic. */
const SHIPPED: AuthoredPlan[] = Object.entries(loaded)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, module]) => {
    const value = (module as { default?: unknown }).default ?? module;
    return value as AuthoredPlan;
  });

function planKey(name: string): string {
  return name.trim().toLowerCase();
}

const BY_NAME = new Map<string, AuthoredPlan>(SHIPPED.map((plan) => [planKey(plan.name), plan]));

/** Every plan that ships with the app, for the validator and its tests. */
export function authoredPlans(): AuthoredPlan[] {
  return [...SHIPPED];
}

/** Null for an item nobody has written a plan for. */
export function authoredPlan(name: string): AuthoredPlan | null {
  return BY_NAME.get(planKey(name)) ?? null;
}

/** An item nobody has written a plan for reads as unique. */
export function planSource(name: string): PlanSource {
  return BY_NAME.get(planKey(name))?.source ?? "unique";
}

/** What finding a plan reads off a card; a generated Prime needs every field. */
export interface PlanLookupTarget {
  name: string;
  uniqueName?: string | undefined;
  kind?: AcquisitionKind | undefined;
  weaponClass?: WeaponClass | null | undefined;
  isPrime?: boolean | undefined;
  parts?: PartPlan | undefined;
}

/** The live data a generated plan is built from. */
export interface PlanLive {
  itemDb: Record<string, ItemDbEntry>;
  relicDb?: RelicDatabase | null | undefined;
  world?: WorldState | null | undefined;
  now?: number | undefined;
}

function primeTarget(target: PlanLookupTarget): PrimeTarget | null {
  const { uniqueName, kind, parts, isPrime } = target;
  if (!uniqueName || !kind || !parts || !isPrime) return null;
  return {
    name: target.name,
    uniqueName,
    kind,
    weaponClass: target.weaponClass ?? null,
    isPrime,
    parts,
  };
}

/** "-" while the trader is away; a stock change always moves its window. */
function traderKey(trader: VaultTrader | null | undefined, now: number): string {
  if (!trader || !activeWindow(trader.activation, trader.expiry, now)) return "-";
  return trader.expiry ?? "?";
}

const GENERATED = new WeakMap<object, WeakMap<RelicDatabase, Map<string, AuthoredPlan | null>>>();

function generatedPlan(target: PrimeTarget, live: PlanLive): AuthoredPlan | null {
  const relicDb = live.relicDb;
  if (!relicDb) return null;
  const now = live.now ?? Date.now();
  const world = live.world;
  const key = world
    ? `${planKey(target.name)}|${traderKey(world.vaultTrader, now)}|${traderKey(world.voidTrader, now)}`
    : `${planKey(target.name)}|?`;
  let byRelics = GENERATED.get(live.itemDb);
  if (!byRelics) GENERATED.set(live.itemDb, (byRelics = new WeakMap()));
  let plans = byRelics.get(relicDb);
  if (!plans) byRelics.set(relicDb, (plans = new Map()));
  if (plans.has(key)) return plans.get(key) ?? null;
  const plan = generatePrimePlan(target, { itemDb: live.itemDb, relicDb, world, now });
  plans.set(key, plan);
  return plan;
}

/** An authored file wins; a relic Prime without one gets a generated plan. Null
 *  is an item nobody can plan, which reads as unknown. */
export function planFor(target: PlanLookupTarget, live: PlanLive | null): AuthoredPlan | null {
  const authored = BY_NAME.get(planKey(target.name));
  if (authored) return authored;
  const prime = live ? primeTarget(target) : null;
  return prime && live ? generatedPlan(prime, live) : null;
}

export interface PlanRating {
  /** False for an item nobody has written a plan for. */
  planned: boolean;
  effort: number | null;
  /** The badge the card draws in its art band; null when the plan has none. */
  badge: PlanBadge | null;
}

export const UNRATED: PlanRating = { planned: false, effort: null, badge: null };

/** The authored effort and badge for a card, without resolving a plan. It runs
 *  once per card in a grid. Null is unrated, which is unknown, never bad. */
export function planRating(name: string): PlanRating {
  const plan = BY_NAME.get(planKey(name));
  if (!plan) return UNRATED;
  return { planned: true, effort: plan.effort, badge: plan.badges[0] ?? null };
}

/** Whether the quest a plan's one-time groups pay out from is done: null when no
 *  group names a quest the item database knows, false whenever the payload
 *  cannot say it is. */
export function planQuestDone(plan: AuthoredPlan, quests: QuestState): boolean | null {
  let answer: boolean | null = null;
  for (const group of plan.groups) {
    const done = group.quest ? questDoneForLabel(quests, group.quest) : null;
    if (done !== null) answer = answer === true || done;
  }
  return answer;
}

/** The route still open once the quest has paid out, or null while it has not. */
export function afterQuestRoute(plan: AuthoredPlan, quests: QuestState): PlanAfterQuest | null {
  return plan.afterQuest && planQuestDone(plan, quests) === true ? plan.afterQuest : null;
}

/** A badge naming a rank the player already holds says nothing to them. */
export function openBadges(
  badges: readonly PlanBadge[],
  inventory: RawInventoryData | null,
): PlanBadge[] {
  return badges.filter((badge) => !badge.rank || rankMet(inventory, badge.rank) !== true);
}

export interface PlayerRead {
  inventory: RawInventoryData | null;
  quests: QuestState;
}

/** The rating of the route the player still has to walk. */
export function planRatingFor(name: string, player: PlayerRead): PlanRating {
  return ratingOf(BY_NAME.get(planKey(name)) ?? null, player);
}

export function ratingOf(plan: AuthoredPlan | null, player: PlayerRead): PlanRating {
  if (!plan) return UNRATED;
  const route = afterQuestRoute(plan, player.quests) ?? plan;
  return {
    planned: true,
    effort: route.effort,
    badge: openBadges(route.badges, player.inventory)[0] ?? null,
  };
}
