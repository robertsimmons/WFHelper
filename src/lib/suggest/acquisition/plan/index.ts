import { authoredPlan } from "./data.js";
import { resolvePlan } from "./resolve.js";
import type { PlanContext, ResolvedPlan } from "./types.js";
import type { PartPlan } from "../types.js";

export { authoredPlan, authoredPlans, planRating, planSource } from "./data.js";
export { earnsFlow, outstandingOf, resolvePlan } from "./resolve.js";
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
  /** The card's item and part plan, so the plan counts what the card counts. */
  uniqueName?: string | undefined;
  parts?: PartPlan | undefined;
}

/** Null for an item nobody has written a plan for; it reads as unknown. */
export function resolvePlanFor(target: PlanTarget, context: PlanContext): ResolvedPlan | null {
  const authored = authoredPlan(target.name);
  if (!authored) return null;
  const card =
    target.uniqueName && target.parts
      ? { uniqueName: target.uniqueName, parts: target.parts }
      : null;
  return resolvePlan(authored, context, target.tier, card);
}
