import { authoredPlan } from "./data.js";
import { fallbackPlan, type FallbackSource } from "./fallback.js";
import { resolvePlan } from "./resolve.js";
import type { PlanContext, ResolvedPlan } from "./types.js";

export { authoredPlan, authoredPlans, planRating } from "./data.js";
export { fallbackPlan, type FallbackSource } from "./fallback.js";
export { resolvePlan } from "./resolve.js";
export { validatePlan } from "./validate.js";
export type { AuthoredPlan, PlanBadge, PlanBadgeTone, PlanLiveState } from "./schema.js";
export type {
  PlanContext,
  PlanFactKind,
  PlanProgressOverride,
  ResolvedGroup,
  ResolvedPlan,
  ResolvedRow,
} from "./types.js";

/** The plan for a target, authored where one exists and derived from the drop
 *  table where none does. A derived plan is marked, never dressed up as one. */
export function resolvePlanFor(source: FallbackSource, context: PlanContext): ResolvedPlan {
  const authored = authoredPlan(source.name);
  if (authored) return resolvePlan(authored, context, source.tier);
  const resolved = resolvePlan(fallbackPlan(source), context, source.tier);
  return {
    ...resolved,
    authored: false,
    progress: context.progress
      ? resolved.progress
      : { ...resolved.progress, resolved: source.parts.known },
  };
}
