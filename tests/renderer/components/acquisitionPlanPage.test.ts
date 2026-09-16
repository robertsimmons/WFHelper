/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";

import { visibleGroups, visibleRows } from "../../../src/components/nextup/plan/planResolution.js";
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

    const helios = resolved("Helios");
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
      "Mining, refined by Otak",
    ]);
  });

  it("leaves the banked line off a group whose own rows name that currency", () => {
    const banks = resolved("Hound").groups.filter((entry) => entry.earns !== null);
    expect(banks).toEqual([]);
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
    expect(view()).toContain("{openResolved.name}");
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
