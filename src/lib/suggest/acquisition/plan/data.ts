import { rankMet } from "./ranks.js";
import { questDoneForLabel, type QuestState } from "./state.js";
import type { AuthoredPlan, PlanAfterQuest, PlanBadge, PlanSource } from "./schema.js";
import type { RawInventoryData } from "../../../../types/inventory.js";

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

export interface PlanRating {
  /** False for an item nobody has written a plan for. */
  planned: boolean;
  effort: number | null;
  /** The badge the card draws in its art band; null when the plan has none. */
  badge: PlanBadge | null;
}

const UNRATED: PlanRating = { planned: false, effort: null, badge: null };

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
  const plan = BY_NAME.get(planKey(name));
  if (!plan) return UNRATED;
  const route = afterQuestRoute(plan, player.quests) ?? plan;
  return {
    planned: true,
    effort: route.effort,
    badge: openBadges(route.badges, player.inventory)[0] ?? null,
  };
}
