import {
  earnsFlow,
  groupDone,
  outstandingOf,
  settleRanks,
  stepCount,
  resolvePlanFor,
  type PlanContext,
  type PlanTarget,
  type PlanProgressOverride,
  type ResolvedGroup,
  type ResolvedPlan,
  type ResolvedRow,
} from "../../../lib/suggest/acquisition/plan/index.js";

/** What the player has answered by hand on one item's plan. */
interface PlanAnswers {
  manualDone: readonly string[];
  manualCleared: readonly string[];
  altsTaken: readonly string[];
}

export interface PinnedPlanInput {
  uniqueName: string;
  target: PlanTarget;
  progress?: PlanProgressOverride | undefined;
  answers?: PlanAnswers | undefined;
}

/** One resolved plan per pinned item, keyed by uniqueName so the strip and the
 *  page read the same resolution. An item with no plan has no key. */
export function resolvePinnedPlans(
  inputs: readonly PinnedPlanInput[],
  context: Omit<PlanContext, "progress" | "manualDone" | "manualCleared" | "altsTaken">,
): Record<string, ResolvedPlan> {
  const plans: Record<string, ResolvedPlan> = {};
  for (const input of inputs) {
    const plan = resolvePlanFor(input.target, {
      ...context,
      progress: input.progress,
      manualDone: input.answers?.manualDone,
      manualCleared: input.answers?.manualCleared,
      altsTaken: input.answers?.altsTaken,
    });
    if (plan) plans[input.uniqueName] = plan;
  }
  return plans;
}

/** What the player ticked on rows the inventory decides, by row id. Held only
 *  while one plan stays open, and written nowhere. */
export type RowOverrides = Readonly<Record<string, boolean>>;

interface PlanViewRow extends ResolvedRow {
  /** Ticked for this visit only; it stays drawn until the plan closes. */
  temporary?: boolean;
}

function findRow(plan: ResolvedPlan, rowId: string): ResolvedRow | undefined {
  for (const group of plan.groups) {
    const row = group.rows.find((entry) => entry.id === rowId);
    if (row) return row;
  }
  return undefined;
}

/** A row only the player can answer persists through `persist`; one the
 *  inventory decides only moves the overrides. */
export function tickPlanRow(
  plan: ResolvedPlan,
  overrides: RowOverrides,
  rowId: string,
  done: boolean,
  persist: (rowId: string, done: boolean) => void,
): RowOverrides {
  const row = findRow(plan, rowId);
  if (!row) return overrides;
  if (row.manual) {
    persist(rowId, done);
    return overrides;
  }
  return { ...overrides, [rowId]: done };
}

/** One tick on a step line that stands for several rows answers all of them. */
export function tickPlanRows(
  plan: ResolvedPlan,
  overrides: RowOverrides,
  rowIds: readonly string[],
  done: boolean,
  persist: (rowId: string, done: boolean) => void,
): RowOverrides {
  return rowIds.reduce((next, id) => tickPlanRow(plan, next, id, done, persist), overrides);
}

/** The plan as the page draws it, with every count that reads done-ness redone
 *  over the overrides, so a later re-resolve never wins over a tick. */
export function withRowOverrides(plan: ResolvedPlan, overrides: RowOverrides): ResolvedPlan {
  if (Object.keys(overrides).length === 0) return plan;
  const ticked = plan.groups.map((group) => ({
    ...group,
    rows: group.rows.map((row): PlanViewRow => {
      const done = overrides[row.id];
      if (row.manual || done === undefined) return row;
      return { ...row, done, temporary: true };
    }),
  }));
  const settled = settleRanks(ticked);
  const groups = ticked.map((group, index): ResolvedGroup => {
    const rows = settled[index];
    const done = groupDone({ ...group, rows });
    return { ...group, rows, done, remaining: done ? 0 : rows.filter((row) => !row.done).length };
  });
  const owed = outstandingOf(groups);
  const ledger = plan.ledger.map((entry) => ({
    ...entry,
    outstanding: owed.get(entry.currency) ?? 0,
  }));
  const flowing = groups.map((group): ResolvedGroup => {
    const earns = group.earns;
    if (earns?.ledger === undefined || earns.full === undefined) return group;
    const outstanding = owed.get(earns.ledger) ?? 0;
    return {
      ...group,
      earns: {
        ...earns,
        ...earnsFlow(earns.currency, earns.authoredAmount, earns.ledger, earns.full, outstanding),
      },
    };
  });
  return { ...plan, groups: flowing, ledger, steps: stepCount(groups) };
}
