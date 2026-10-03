import {
  earnsFlow,
  outstandingOf,
  resolvePlanFor,
  type PlanContext,
  type PlanTarget,
  type PlanProgressOverride,
  type ResolvedGroup,
  type ResolvedPlan,
  type ResolvedRow,
} from "../../../lib/suggest/acquisition/plan/index.js";
import { formatQuantity } from "../../../lib/suggest/acquisition/plan/state.js";

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

/** What the plan has left to do. A row inventory covers vanishes rather than
 *  standing struck through; a row only the player can answer keeps its tick, so
 *  ticking one is never a one-way door. A row ticked this visit stays put rather
 *  than vanishing from under the cursor. */
export function visibleRows(group: ResolvedGroup, showDone: boolean): PlanViewRow[] {
  const rows: readonly PlanViewRow[] = group.rows;
  if (showDone) return [...rows];
  return rows.filter((row) => row.temporary === true || !(row.done && row.source === "inventory"));
}

/** A skipped group stands whether or not it has a row left, because its reason
 *  is what makes the plan read complete. */
export function visibleGroups(plan: ResolvedPlan, showDone: boolean): ResolvedGroup[] {
  if (showDone) return [...plan.groups];
  return plan.groups.filter((group) => group.skip !== null || visibleRows(group, false).length > 0);
}

/** What the player ticked on rows the inventory decides, by row id. Held only
 *  while one plan stays open, and written nowhere. */
export type RowOverrides = Readonly<Record<string, boolean>>;

export interface PlanViewRow extends ResolvedRow {
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

/** The plan as the page draws it, with every count that reads done-ness redone
 *  over the overrides, so a later re-resolve never wins over a tick. */
export function withRowOverrides(plan: ResolvedPlan, overrides: RowOverrides): ResolvedPlan {
  if (Object.keys(overrides).length === 0) return plan;
  const groups = plan.groups.map((group): ResolvedGroup => {
    const rows = group.rows.map((row): PlanViewRow => {
      const done = overrides[row.id];
      if (row.manual || done === undefined) return row;
      return { ...row, done, temporary: true };
    });
    const remaining = group.skip !== null ? 0 : rows.filter((row) => !row.done).length;
    return {
      ...group,
      rows,
      done: group.skip !== null || rows.every((row) => row.done),
      remaining,
    };
  });
  let total = 0;
  let done = 0;
  for (const group of groups) {
    if (group.skip !== null) continue;
    total += group.rows.length;
    done += group.rows.filter((row) => row.done).length;
  }
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
      earns: earnsFlow(earns.currency, earns.authoredAmount, earns.ledger, earns.full, outstanding),
    };
  });
  return { ...plan, groups: flowing, ledger, steps: { done, total } };
}

/** A tracked count still short of a multi-unit need reads as how far along it
 *  is; anything else keeps the resolver's text. */
export function rowQuantityText(row: ResolvedRow): string {
  const qty = row.qty;
  if (!qty) return "";
  if (row.done || !qty.tracked || qty.required <= 1) return qty.text;
  return `${formatQuantity(Math.min(qty.owned, qty.required))} / ${qty.requiredText}`;
}
