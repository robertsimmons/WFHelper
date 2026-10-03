import { authoredPlan } from "./data.js";
import { resolvePlan } from "./resolve.js";
import type { PlanContext, ResolvedPlan } from "./types.js";

export { authoredPlan, authoredPlans, planRating, planSource } from "./data.js";
export { resolvePlan } from "./resolve.js";
export { validatePlan } from "./validate.js";
export type {
  AuthoredPlan,
  PlanBadge,
  PlanBadgeTone,
  PlanLiveState,
  PlanSource,
} from "./schema.js";
export type {
  PlanContext,
  PlanFactKind,
  PlanProgressOverride,
  ResolvedGroup,
  ResolvedPlan,
  ResolvedRow,
} from "./types.js";

/** What resolving a plan needs off an acquisition target. */
export interface PlanTarget {
  name: string;
  /** The letter the card draws: the player's override, else the ranking table. */
  tier: string | null;
}

/** Null for an item nobody has written a plan for; it reads as unknown. */
export function resolvePlanFor(target: PlanTarget, context: PlanContext): ResolvedPlan | null {
  const authored = authoredPlan(target.name);
  return authored ? resolvePlan(authored, context, target.tier) : null;
}
