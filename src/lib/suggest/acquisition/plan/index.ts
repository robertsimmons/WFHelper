import { planFor } from "./data.js";
import { resolvePlan } from "./resolve.js";
import type { PlanContext, ResolvedPlan } from "./types.js";
import type { AcquisitionKind, PartPlan, WeaponClass } from "../types.js";

export { authoredPlan, authoredPlans, planFor, planRating, planSource, UNRATED } from "./data.js";
export { generatePrimePlan } from "./prime.js";
export { primeOverrides } from "./primeOverrides.js";
export { earnsFlow, outstandingOf, resolvePlan } from "./resolve.js";
export { validatePlan, validatePrimeOverride, validateResources } from "./validate.js";
export type { AuthoredPlan, PlanBadge, PlanBadgeTone, PlanLiveState } from "./schema.js";
export type { ItemTip } from "../tips/data.js";
export type {
  PlanContext,
  PlanFactKind,
  PlanProgressOverride,
  ResolvedGroup,
  ResolvedPlan,
  ResolvedRoute,
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
  /** What a generated Prime plan reads; absent leaves only an authored file. */
  kind?: AcquisitionKind | undefined;
  weaponClass?: WeaponClass | null | undefined;
  isPrime?: boolean | undefined;
}

/** Null for an item nothing can plan; it reads as unknown. An authored file wins
 *  over a generated Prime plan. */
export function resolvePlanFor(target: PlanTarget, context: PlanContext): ResolvedPlan | null {
  const authored = planFor(target, {
    itemDb: context.itemDb,
    relicDb: context.relicDb,
    world: context.world,
    now: context.now,
  });
  if (!authored) return null;
  const card =
    target.uniqueName && target.parts
      ? { uniqueName: target.uniqueName, parts: target.parts }
      : null;
  return resolvePlan(authored, context, target.tier, card);
}
