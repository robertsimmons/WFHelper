import {
  resolvePlanFor,
  type FallbackSource,
  type PlanContext,
  type PlanProgressOverride,
  type ResolvedGroup,
  type ResolvedPlan,
  type ResolvedRow,
} from "../../../lib/suggest/acquisition/plan/index.js";

/** What the player has answered by hand on one item's plan. */
export interface PlanAnswers {
  manualDone: readonly string[];
  manualCleared: readonly string[];
  altsTaken: readonly string[];
}

export interface PinnedPlanInput {
  uniqueName: string;
  target: FallbackSource;
  progress?: PlanProgressOverride | undefined;
  answers?: PlanAnswers | undefined;
}

/** One resolved plan per pinned item, keyed by uniqueName so the strip and the
 *  page read the same resolution. */
export function resolvePinnedPlans(
  inputs: readonly PinnedPlanInput[],
  context: Omit<PlanContext, "progress" | "manualDone" | "manualCleared" | "altsTaken">,
): Record<string, ResolvedPlan> {
  const plans: Record<string, ResolvedPlan> = {};
  for (const input of inputs) {
    plans[input.uniqueName] = resolvePlanFor(input.target, {
      ...context,
      progress: input.progress,
      manualDone: input.answers?.manualDone,
      manualCleared: input.answers?.manualCleared,
      altsTaken: input.answers?.altsTaken,
    });
  }
  return plans;
}

/** What the plan has left to do. A row inventory covers vanishes rather than
 *  standing struck through; a row only the player can answer keeps its tick, so
 *  ticking one is never a one-way door. */
export function visibleRows(group: ResolvedGroup, showDone: boolean): ResolvedRow[] {
  if (showDone) return [...group.rows];
  return group.rows.filter((row) => !(row.done && row.source === "inventory"));
}

/** A skipped group stands whether or not it has a row left, because its reason
 *  is what makes the plan read complete. */
export function visibleGroups(plan: ResolvedPlan, showDone: boolean): ResolvedGroup[] {
  if (showDone) return [...plan.groups];
  return plan.groups.filter((group) => group.skip !== null || visibleRows(group, false).length > 0);
}
