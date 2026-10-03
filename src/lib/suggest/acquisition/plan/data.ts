import type { AuthoredPlan, PlanBadge, PlanSource } from "./schema.js";

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

interface PlanRating {
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
