/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  tickPlanRow,
  visibleGroups,
  visibleRows,
  withRowOverrides,
  rowQuantityText,
  type RowOverrides,
} from "../../../src/components/nextup/plan/planResolution.js";
import {
  authoredPlan,
  resolvePlan,
  type PlanContext,
  type ResolvedGroup,
  type ResolvedPlan,
  type ResolvedRow,
} from "../../../src/lib/suggest/acquisition/plan/index.js";
import {
  planProgress,
  planProgressFor,
  setPlanRowDone,
  togglePlanAltTaken,
} from "../../../src/stores/acquisitionPlanProgress.js";

// Vitest has no Svelte plugin, so the page is read as source. Resolved from
// this file rather than the cwd, which in a worktree is the other checkout.
const PLAN_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "components",
  "nextup",
  "plan",
);

const source = (file: string): string => fs.readFileSync(path.join(PLAN_DIR, file), "utf8");

const VIEW = path.join(PLAN_DIR, "..", "..", "..", "views", "NextUpView.svelte");

const view = (): string => fs.readFileSync(VIEW, "utf8");

const EMPTY: PlanContext = { itemDb: {}, inventory: null, now: Date.UTC(2025, 0, 1) };

function resolved(name: string, context: Partial<PlanContext> = {}): ResolvedPlan {
  const plan = authoredPlan(name);
  if (!plan) throw new Error(`no plan for ${name}`);
  return resolvePlan(plan, { ...EMPTY, ...context });
}

function row(id: string, done: boolean, source: ResolvedRow["source"]): ResolvedRow {
  return {
    id,
    label: id,
    note: null,
    qty: null,
    alt: null,
    done,
    source,
    manual: source !== "inventory",
  };
}

function group(id: string, rows: ResolvedRow[], skip: { reason: string } | null): ResolvedGroup {
  return {
    id,
    type: "farm",
    place: "GABII, CERES",
    sub: null,
    activity: null,
    meta: null,
    mode: null,
    live: null,
    skip,
    earns: null,
    spends: [],
    map: null,
    mapReady: false,
    rows,
    conditions: [],
    bonuses: [],
    disclosures: [],
    facts: [],
    done: rows.every((entry) => entry.done),
    remaining: skip ? 0 : rows.filter((entry) => !entry.done).length,
  };
}

function rowIdOf(plan: ResolvedPlan, label: string): string {
  for (const group of plan.groups) {
    for (const row of group.rows) if (row.label === label) return row.id;
  }
  throw new Error(`no row labelled ${label}`);
}

function rowById(plan: ResolvedPlan, id: string): ResolvedRow | undefined {
  return plan.groups.flatMap((group) => group.rows).find((row) => row.id === id);
}

describe("acquisition plan page", () => {
  it("never draws a row inventory already covers, and keeps the ones it cannot", () => {
    const rows = [
      row("owned", true, "inventory"),
      row("ticked", true, "manual"),
      row("todo", false, "inventory"),
    ];
    const shown = visibleRows(group("0", rows, null), false);
    expect(shown.map((entry) => entry.id)).toEqual(["ticked", "todo"]);
    expect(visibleRows(group("0", rows, null), true)).toHaveLength(3);
  });

  it("drops a finished group but keeps a skipped one with its reason", () => {
    const covered = group("0", [row("owned", true, "inventory")], null);
    const skipped = group("1", [row("owned", true, "inventory")], { reason: "already researched" });
    const open = group("2", [row("todo", false, "inventory")], null);
    const plan = { groups: [covered, skipped, open] } as ResolvedPlan;
    expect(visibleGroups(plan, false).map((entry) => entry.id)).toEqual(["1", "2"]);
    expect(visibleGroups(plan, true)).toHaveLength(3);

    const helios = resolved("Sarpa");
    const shown = visibleGroups(helios, false);
    const authoredSkips = helios.groups.filter((entry) => entry.skip !== null);
    expect(authoredSkips.length).toBeGreaterThan(0);
    for (const entry of authoredSkips) {
      expect(shown).toContain(entry);
      expect(entry.skip?.reason).toBeTruthy();
    }
  });

  it("dims a skipped group rather than deleting it", () => {
    const text = source("PlanGroup.svelte");
    expect(text).toContain("opacity-[0.42]");
    expect(text).toContain("group.skip.reason");
  });

  it("keeps conditions and bonuses visible and puts depth behind a disclosure", () => {
    const text = source("PlanGroup.svelte");
    const notes = text.indexOf("group.conditions as condition");
    const disclosures = text.indexOf("group.disclosures as disclosure");
    expect(notes).toBeGreaterThan(-1);
    expect(text).toContain("group.bonuses as bonus");
    expect(disclosures).toBeGreaterThan(notes);
    // Collapsed: a details element with no open attribute.
    expect(text).toContain("<details");
    expect(text).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("colours each live state as the state it is", () => {
    const text = source("PlanGroup.svelte");
    for (const [state, tone] of [
      ["open", "text-success"],
      ["blocked", "text-danger"],
      ["waiting", "text-warning"],
    ]) {
      expect(text).toMatch(new RegExp(`${state}:\\s*"${tone}"`));
    }
  });

  it("sets the real-money price apart from the ones that cost time", () => {
    const mesa = resolved("Mesa Prime");
    expect(mesa.prices.filter((price) => price.money)).toHaveLength(1);
    expect(mesa.prices.filter((price) => !price.money).length).toBeGreaterThan(0);
    const text = source("AcquisitionPlanPage.svelte");
    expect(text).toContain("{#if note.money}");
    expect(text).toContain("border-warning/60");
  });

  it("draws a map link disabled while no map has shipped", () => {
    const hound = resolved("Hound");
    const mapped = hound.groups.filter((group) => group.map !== null);
    expect(mapped.length).toBeGreaterThan(0);
    for (const group of mapped) expect(group.mapReady).toBe(false);
    const text = source("PlanGroup.svelte");
    expect(text).toContain("{#if group.map}");
    expect(text).toContain("disabled={!group.mapReady}");
  });

  it("ticks a row by hand, and the tick keeps its place", () => {
    const id = rowIdOf(resolved("Rhino"), "Neuroptics");
    const before = resolved("Rhino", { manualDone: [] })
      .groups.flatMap((entry) => entry.rows)
      .find((entry) => entry.id === id);
    expect(before?.done).toBe(false);

    const after = resolved("Rhino", { manualDone: [id] });
    const ticked = after.groups.flatMap((entry) => entry.rows).find((entry) => entry.id === id);
    expect(ticked?.done).toBe(true);
    expect(ticked?.source).toBe("manual");
    expect(ticked?.manual).toBe(true);
    // Only the player can answer this row, so it stays clickable instead of
    // vanishing the moment it is ticked.
    const holder = after.groups.find((entry) => entry.rows.some((r) => r.id === id));
    expect(visibleRows(holder!, false).some((entry) => entry.id === id)).toBe(true);
    expect(after.steps.done).toBeGreaterThan(resolved("Rhino").steps.done);
  });

  it("counts an alternative the player took, and only then", () => {
    const plan = resolved("Cyte-09");
    const priced = plan.groups
      .flatMap((group) => group.rows)
      .filter((row) => (row.alt?.spends.length ?? 0) > 0);
    expect(priced.length).toBeGreaterThan(0);
    const currency = priced[0].alt!.spends[0].currency;
    const id = priced[0].id;

    const untaken = plan.ledger.find((line) => line.currency === currency);
    expect(untaken).toBeUndefined();

    const taken = resolved("Cyte-09", { altsTaken: [id] });
    const line = taken.ledger.find((entry) => entry.currency === currency);
    expect(line?.spent).toBe(priced[0].alt!.spends[0].value);
    expect(line?.paired).toBe(false);
  });

  it("lets a tick clear a row an authored plan starts as done", () => {
    const id = rowIdOf(resolved("Hound"), "The War Within");
    expect(rowById(resolved("Hound"), id)?.done).toBe(true);

    const cleared = resolved("Hound", { manualCleared: [id] });
    expect(rowById(cleared, id)?.done).toBe(false);
    expect(rowById(cleared, id)?.source).toBe("manual");
  });

  it("names the days a standing currency needs once, on whoever banks it", () => {
    const carriers = resolved("Hound").groups.filter((entry) =>
      entry.facts.some((fact) => fact.kind === "standing"),
    );
    // Solaris United has an earner and Entrati does not, so one group each:
    // whoever banks it, and failing that the first group that spends it.
    expect(carriers.map((entry) => entry.activity)).toEqual([
      "Conservation, plus Bounty 1 for the bonds",
      "buy the Trapezium Xenorhast refining blueprint",
    ]);
  });

  it("leaves the banked line off a group whose own rows name that currency", () => {
    const banks = resolved("Hound").groups.filter((entry) => entry.earns !== null);
    expect(banks).toEqual([]);
  });

  it("opens an item with no plan on a plain unknown state", () => {
    const text = source("AcquisitionPlanPage.svelte");
    expect(text).toContain("plan: ResolvedPlan | null;");
    const unknown = text.indexOf("{#if !plan}");
    expect(unknown).toBeGreaterThan(-1);
    expect(text.slice(unknown, text.indexOf("{/if}", unknown))).toContain(
      '<div class="empty-state" data-plan-none>',
    );
    expect(text).toContain('$tr("nextUp.planNone")');
    // The page opens on the pin, not on whether a plan resolved for it.
    expect(view()).toContain("{#if openPlan && openTarget}");
    expect(view()).not.toContain("{#if openPlan && openResolved}");
  });

  it("collapses a skipped group with nothing left to show", () => {
    const text = source("PlanGroup.svelte");
    expect(text).toContain("const settled = $derived(skipped && rows.length === 0);");
    expect(text).toContain("{#if settled}");
  });
});

describe("leaving a plan", () => {
  it("puts the only way back in the header, where the plan cannot scroll it away", () => {
    const text = view();
    const back = text.indexOf("data-plan-back");
    const scroller = text.indexOf("overflow-y-auto");
    expect(back).toBeGreaterThan(-1);
    expect(back).toBeLessThan(scroller);
    expect(text).toContain("onclick={() => (openPlan = null)}");
    expect(source("AcquisitionPlanPage.svelte")).not.toContain("onBack");
  });

  it("names the plan beside the crumb that leaves it", () => {
    expect(view()).toContain("{openTarget.name}");
  });

  it("leaves a plan on Escape, unless the settings modal is the one holding it", () => {
    expect(view()).toContain(
      'if (event.key !== "Escape" || openPlan === null || settingsOpen) return;',
    );
    expect(view()).toContain("<svelte:window onkeydown={onWindowKey} />");
  });
});

describe("plan progress store", () => {
  const RHINO = "/Lotus/Powersuits/Rhino/Rhino";
  const CYTE = "/Lotus/Powersuits/Cyte/Cyte";

  beforeEach(() => {
    for (const [item, entry] of Object.entries(get(planProgress))) {
      for (const id of entry.manualDone) setPlanRowDone(item, id, false);
      for (const id of entry.altsTaken) togglePlanAltTaken(item, id);
    }
  });

  it("round-trips a tick and an alternative, per item", () => {
    setPlanRowDone(RHINO, "1:0", true);
    togglePlanAltTaken(CYTE, "1:0");

    const table = get(planProgress);
    expect(planProgressFor(table, RHINO).manualDone).toEqual(["1:0"]);
    expect(planProgressFor(table, RHINO).altsTaken).toEqual([]);
    expect(planProgressFor(table, CYTE).altsTaken).toEqual(["1:0"]);

    setPlanRowDone(RHINO, "1:0", false);
    expect(planProgressFor(get(planProgress), RHINO).manualDone).toEqual([]);
    expect(planProgressFor(get(planProgress), RHINO).manualCleared).toEqual(["1:0"]);
  });
});

describe("temporary ticks on rows the inventory decides", () => {
  const ITEM = "/Lotus/Powersuits/Rhino/Rhino";

  function plan(rows: ResolvedRow[]): ResolvedPlan {
    return { ...resolved("Rhino"), groups: [group("0", rows, null)], steps: { done: 0, total: 0 } };
  }

  function viewRow(view: ResolvedPlan, id: string): ResolvedRow | undefined {
    return rowById(view, id);
  }

  it("manual row persists through the store and never becomes an override", () => {
    const base = plan([row("hand", false, "authored")]);
    const persist = vi.fn();
    const next = tickPlanRow(base, {}, "hand", true, persist);
    expect(persist).toHaveBeenCalledWith("hand", true);
    expect(next).toEqual({});
    expect(viewRow(withRowOverrides(base, { hand: true }), "hand")?.done).toBe(false);
  });

  it("tracked row ticks temporarily, and every count follows", () => {
    const base = plan([row("inv", false, "inventory"), row("other", true, "inventory")]);
    const overrides = tickPlanRow(base, {}, "inv", true, vi.fn());
    const view = withRowOverrides(base, overrides);
    expect(viewRow(view, "inv")?.done).toBe(true);
    expect(view.groups[0].done).toBe(true);
    expect(view.groups[0].remaining).toBe(0);
    expect(view.steps).toEqual({ done: 2, total: 2 });
  });

  it("tracked row unticks temporarily", () => {
    const base = plan([row("inv", true, "inventory")]);
    const overrides = tickPlanRow(base, {}, "inv", false, vi.fn());
    const view = withRowOverrides(base, overrides);
    expect(viewRow(view, "inv")?.done).toBe(false);
    expect(view.groups[0].done).toBe(false);
    expect(view.steps).toEqual({ done: 0, total: 1 });
  });

  it("keeps an override on top when the inventory re-resolves", () => {
    const overrides: RowOverrides = { inv: false };
    const reresolved = plan([row("inv", true, "inventory")]);
    expect(viewRow(withRowOverrides(reresolved, overrides), "inv")?.done).toBe(false);
  });

  it("overrides reset on reopen and on switching to another pin's plan", () => {
    const base = plan([row("inv", true, "inventory")]);
    expect(withRowOverrides(base, {})).toBe(base);
    // The overrides live in the page, which the view unmounts on close and
    // remounts per pin.
    expect(source("AcquisitionPlanPage.svelte")).toContain(
      "let overrides = $state<RowOverrides>({});",
    );
    const text = view();
    expect(text).toContain("{#key openPlan}");
    expect(text.indexOf("{#if openPlan && openTarget}")).toBeLessThan(
      text.indexOf("{#key openPlan}"),
    );
  });

  it("ticked tracked row stays visible, while one the inventory finished stays hidden", () => {
    const base = plan([row("inv", false, "inventory"), row("gone", true, "inventory")]);
    const view = withRowOverrides(base, tickPlanRow(base, {}, "inv", true, vi.fn()));
    const shown = visibleRows(view.groups[0], false).map((entry) => entry.id);
    expect(shown).toEqual(["inv"]);
    expect(visibleGroups(view, false)).toHaveLength(1);
  });

  it("no writes to the store for tracked rows", () => {
    const before = JSON.stringify(get(planProgress));
    const persist = vi.fn((id: string, done: boolean) => setPlanRowDone(ITEM, id, done));
    const base = plan([row("inv", false, "inventory"), row("inv2", true, "inventory")]);
    let overrides = tickPlanRow(base, {}, "inv", true, persist);
    overrides = tickPlanRow(base, overrides, "inv2", false, persist);
    expect(overrides).toEqual({ inv: true, inv2: false });
    expect(persist).not.toHaveBeenCalled();
    expect(JSON.stringify(get(planProgress))).toBe(before);
  });

  it("makes every row's box clickable outside a skipped group", () => {
    expect(source("PlanRow.svelte")).toContain("{#if !skipped}");
  });
});

describe("row quantity text", () => {
  function counted(
    done: boolean,
    tracked: boolean,
    required: number,
    owned: number,
  ): ResolvedRow {
    const remaining = Math.max(0, required - owned);
    const text = (done ? required : remaining).toLocaleString("en-US");
    return {
      ...row("r", done, tracked ? "inventory" : "authored"),
      qty: {
        required,
        owned,
        remaining,
        text,
        requiredText: required.toLocaleString("en-US"),
        tracked,
      },
    };
  }

  it("shows have / need on a tracked, unfinished multi-unit row", () => {
    expect(rowQuantityText(counted(false, true, 2, 1))).toBe("1 / 2");
    expect(rowQuantityText(counted(false, true, 500, 120))).toBe("120 / 500");
  });

  it("formats both sides the way the resolver formats a count", () => {
    expect(rowQuantityText(counted(false, true, 15000, 1200))).toBe("1,200 / 15,000");
  });

  it("caps have at need", () => {
    expect(rowQuantityText(counted(false, true, 2, 5))).toBe("2 / 2");
  });

  it("keeps today's text on a done row", () => {
    expect(rowQuantityText(counted(true, true, 500, 500))).toBe("500");
  });

  it("keeps today's text on an untracked row", () => {
    expect(rowQuantityText(counted(false, false, 500, 120))).toBe("380");
  });

  it("keeps today's text on a single-quantity row", () => {
    expect(rowQuantityText(counted(false, true, 1, 0))).toBe("1");
  });

  it("draws nothing for a row with no quantity", () => {
    expect(rowQuantityText(row("r", false, "inventory"))).toBe("");
  });

  it("draws the row's count through the helper", () => {
    expect(source("PlanRow.svelte")).toContain("{rowQuantityText(row)}");
  });
});
