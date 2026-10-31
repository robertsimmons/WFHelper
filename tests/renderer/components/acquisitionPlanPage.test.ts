/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  tickPlanRow,
  tickPlanRows,
  withRowOverrides,
  type RowOverrides,
} from "../../../src/components/nextup/plan/planResolution.js";
import { planSteps, type PlanStep } from "../../../src/components/nextup/plan/planSteps.js";
import { en } from "../../../src/i18n/en.js";
import {
  authoredPlan,
  resolvePlan,
  type AuthoredPlan,
  type PlanContext,
  type ResolvedGroup,
  type ResolvedPlan,
  type ResolvedRow,
} from "../../../src/lib/suggest/acquisition/plan/index.js";
import { planGroup } from "../../../src/lib/suggest/acquisition/plan/materials.js";
import type { Translator } from "../../../src/lib/i18n.js";
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
const nextup = (file: string): string => source(path.join("..", file));

const VIEW = path.join(PLAN_DIR, "..", "..", "..", "views", "NextUpView.svelte");

const view = (): string => fs.readFileSync(VIEW, "utf8");

const t: Translator = (key, params = {}) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

const EMPTY: PlanContext = { itemDb: {}, inventory: null, now: Date.UTC(2025, 0, 1) };

function authored(name: string): AuthoredPlan {
  const plan = authoredPlan(name);
  if (!plan) throw new Error(`no plan for ${name}`);
  return plan;
}

function resolved(name: string | AuthoredPlan, context: Partial<PlanContext> = {}): ResolvedPlan {
  return resolvePlan(typeof name === "string" ? authored(name) : name, { ...EMPTY, ...context });
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
    tips: [],
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

/** The step that draws a plan row, as a line of its own or folded into its title. */
function stepOf(plan: ResolvedPlan, id: string): PlanStep | undefined {
  return planSteps(plan, { t }).find(
    (step) =>
      step.rows.some((line) => line.ids.includes(id)) ||
      step.folded?.rows.some((fold) => fold.id === id) === true,
  );
}

/** The source with every block gated on the page's controls cut out, which is
 *  what renders when a surface passes none. */
function readOnly(text: string): string {
  const opener = /\{#if (?:ticks|controls)\b/g;
  let out = text;
  for (let match = opener.exec(out); match; match = opener.exec(out)) {
    let depth = 0;
    const block = /\{#if\b|\{\/if\}/g;
    block.lastIndex = match.index;
    let end = -1;
    for (let tag = block.exec(out); tag; tag = block.exec(out)) {
      depth += tag[0] === "{/if}" ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    if (end === -1) throw new Error("unbalanced {#if}");
    out = out.slice(0, match.index) + out.slice(end);
    opener.lastIndex = match.index;
  }
  return out;
}

describe("acquisition plan page", () => {
  it("draws the same body the details modal does", () => {
    const page = source("AcquisitionPlanPage.svelte");
    expect(page).toContain("<AcquisitionBody {plan} root={treeRoot}");
    expect(page).not.toContain("<CraftingTree");
    expect(page).not.toContain("PlanGroup");
    expect(fs.existsSync(path.join(PLAN_DIR, "PlanGroup.svelte"))).toBe(false);
    expect(fs.existsSync(path.join(PLAN_DIR, "PlanRow.svelte"))).toBe(false);
    // One column as wide as the modal's.
    expect(page).toContain("max-w-[640px]");
  });

  it("lays the body out as steps, then parts, then tips", () => {
    const body = nextup("AcquisitionBody.svelte");
    const steps = body.indexOf("<PlanSteps");
    const parts = body.indexOf("<AcquisitionTree");
    const extra = body.indexOf("{@render extra?.()}");
    const tips = body.indexOf("data-details-tips");
    const sentiment = body.indexOf("data-plan-sentiment");
    expect(steps).toBeGreaterThan(-1);
    expect([steps, parts, extra, tips, sentiment]).toEqual(
      [steps, parts, extra, tips, sentiment].sort((a, b) => a - b),
    );
    expect(body).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("keeps a skipped step listed, dimmed and with its reason", () => {
    const sarpa = resolved("Sarpa");
    const skipped = sarpa.groups.filter((entry) => entry.skip !== null);
    expect(skipped.length).toBeGreaterThan(0);
    const steps = planSteps(sarpa, { t });
    for (const entry of skipped) {
      const step = steps.find((candidate) => candidate.id === entry.id);
      expect(step).toMatchObject({ done: true, skip: entry.skip?.reason });
    }
    const text = source("PlanSteps.svelte");
    expect(text).toContain("{#if step.skip}");
    expect(text).toMatch(/step\.done\s*\?\s*'opacity-\[0\.42\]'/);
  });

  it("keeps conditions, bonuses and a step's tips one collapsed click down", () => {
    const text = source("PlanSteps.svelte");
    const notes = text.indexOf("data-step-notes");
    expect(notes).toBeGreaterThan(-1);
    for (const part of [
      "step.conditions as condition",
      "step.bonuses as bonus",
      "<PlanTips tips={step.tips}",
    ]) {
      expect(text.indexOf(part)).toBeGreaterThan(notes);
    }
    expect(text).toContain("step.disclosures as disclosure");
    expect(text).not.toMatch(/<details[^>]*\bopen\b/);
    const tipsView = source("PlanTips.svelte");
    expect(tipsView).toContain("tip.kind === 'gotcha' ? 'text-warning' : 'text-text-muted'");
    expect(tipsView).toContain("nextUp.planTipDisputed");
  });

  it("carries a group's mode, spends, meta and row notes onto its step", () => {
    const farm = planGroup(
      "vendor",
      "EARTH",
      [
        { qty: "4", label: "Neurodes", note: "from the boss", alt: null, done: false },
        { qty: "2", label: "Rubedo", note: null, alt: null, done: false },
      ],
      {
        meta: "keep spare copies",
        mode: "solo",
        spends: [{ currency: "Credits", amount: "5,000" }],
      },
    );
    const plan: AuthoredPlan = { ...authored("Rhino"), groups: [farm] };
    const [step] = planSteps(resolved(plan), { t });
    expect(step.tags).toEqual(
      expect.arrayContaining(["solo", "keep spare copies", "spends 5,000 Credits"]),
    );
    const neurodes = step.rows.find((line) => line.label === "Neurodes");
    expect(neurodes?.notes).toEqual(["from the boss"]);
  });

  it("puts the currency ledger behind a disclosure on both surfaces", () => {
    const text = source("PlanSteps.svelte");
    expect(text).toContain("data-plan-ledger");
    expect(text).toContain("nextUp.planOutstanding");
    expect(text).toContain("nextUp.planToSpend");
    expect(text).toContain("nextUp.planBanked");
  });

  it("colours each live state as the state it is", () => {
    const text = source("PlanSteps.svelte");
    for (const [state, tone] of [
      ["open", "text-success"],
      ["blocked", "text-danger"],
      ["waiting", "text-warning"],
    ]) {
      expect(text).toMatch(new RegExp(`${state}:\\s*"${tone}"`));
    }
  });

  it("sets the real-money price apart from the ones that cost time", () => {
    const plan = structuredClone(authored("War Prime"));
    plan.prices = [
      { label: "build", amount: "25,000 cr", money: false },
      { label: "bundle", amount: "$1.00", money: true },
    ];
    const war = resolved(plan);
    expect(war.prices.filter((price) => price.money)).toHaveLength(1);
    expect(war.prices.filter((price) => !price.money).length).toBeGreaterThan(0);
    const text = source("AcquisitionPlanPage.svelte");
    expect(text).toContain("{#if note.money}");
    expect(text).toContain("border-warning/60");
  });

  it("opens an item with no plan on a plain unknown state", () => {
    const text = source("AcquisitionPlanPage.svelte");
    expect(text).toContain("plan: ResolvedPlan | null;");
    expect(text).toMatch(/\{#snippet unplanned\(\)\}\s*<div class="empty-state" data-plan-none>/);
    expect(text).toContain('$tr("nextUp.planNone")');
    expect(nextup("AcquisitionBody.svelte")).toMatch(
      /\{#if plan\}\s*<PlanSteps[^>]*\/>\s*\{:else\}\s*\{@render unplanned\?\.\(\)\}/,
    );
    // The page opens on the pin, not on whether a plan resolved for it.
    expect(view()).toContain("{#if openPlan && openTarget}");
    expect(view()).not.toContain("{#if openPlan && openResolved}");
  });

  it("names every key the page and the body resolve", () => {
    for (const text of [
      source("AcquisitionPlanPage.svelte"),
      source("PlanSteps.svelte"),
      nextup("AcquisitionBody.svelte"),
    ]) {
      const keys = [...text.matchAll(/\$tr\(\s*"([\w.]+)"/g)].map((match) => match[1]);
      expect(keys.filter((key) => !(key in en))).toEqual([]);
    }
  });
});

describe("interactive and read-only steps", () => {
  const CONTROLS = [
    "data-step-tick",
    "data-fold-tick",
    "data-row-tick",
    "data-alt-take",
    "data-plan-map",
  ];

  it("draws every control only where the page passed its controls", () => {
    const text = source("PlanSteps.svelte");
    for (const control of CONTROLS) expect(text).toContain(control);
    const plain = readOnly(text);
    for (const control of CONTROLS) expect(plain).not.toContain(control);
    // What the steps say stays: the read-only body is the same body.
    for (const kept of ["step.title", "row.label", "alt.label", "data-plan-ledger"]) {
      expect(plain).toContain(kept);
    }
  });

  it("hands the controls to the plan page and none to the modal", () => {
    expect(source("AcquisitionPlanPage.svelte")).toMatch(/<AcquisitionBody[^>]*\{controls\}/);
    const modal = nextup("SuggestionDetailsModal.svelte");
    const body = /<AcquisitionBody[^>]*\/>/.exec(modal)?.[0];
    expect(body).toBeDefined();
    expect(body).not.toContain("controls");
    expect(nextup("AcquisitionBody.svelte")).toContain(
      "<PlanSteps {plan} {buildable} {controls} />",
    );
  });

  it("never offers a tick on a step the player covered another way", () => {
    expect(source("PlanSteps.svelte")).toContain(
      "{@const ticks = controls && step.skip === null ? controls : null}",
    );
  });

  it("ticks a manual row and the step it sits on follows", () => {
    const id = rowIdOf(resolved("Rhino"), "Rhino Neuroptics");
    const before = stepOf(resolved("Rhino", { manualDone: [] }), id);
    expect(before).toBeDefined();
    const line = before?.rows.find((entry) => entry.ids.includes(id));
    const fold = before?.folded?.rows.find((entry) => entry.id === id);
    expect(line?.done ?? fold?.done).toBe(false);

    const persist = vi.fn();
    const base = resolved("Rhino");
    expect(tickPlanRows(base, {}, [id], true, persist)).toEqual({});
    expect(persist).toHaveBeenCalledWith(id, true);

    const after = resolved("Rhino", { manualDone: [id] });
    expect(rowById(after, id)).toMatchObject({ done: true, source: "manual", manual: true });
    const step = stepOf(after, id);
    const ticked = step?.rows.find((entry) => entry.ids.includes(id));
    const tickedFold = step?.folded?.rows.find((entry) => entry.id === id);
    expect(ticked?.done ?? tickedFold?.done).toBe(true);
  });

  it("ticks every row a merged line stands for at once", () => {
    const base = {
      ...resolved("Rhino"),
      groups: [group("0", [row("a", false, "inventory"), row("b", false, "authored")], null)],
    };
    const persist = vi.fn();
    const overrides = tickPlanRows(base, {}, ["a", "b"], true, persist);
    expect(overrides).toEqual({ a: true });
    expect(persist).toHaveBeenCalledWith("b", true);
  });

  it("takes an alternative from its step, and the ledger counts it", () => {
    const plan = resolved("Cyte-09");
    const offers = planSteps(plan, { t }).flatMap((step) => step.alts.filter((alt) => alt.offer));
    expect(offers.length).toBeGreaterThan(0);
    const [offer] = offers;
    expect(offer.taken).toBe(false);
    const priced = rowById(plan, offer.id);
    const currency = priced?.alt?.spends[0].currency;
    expect(plan.ledger.find((line) => line.currency === currency)).toBeUndefined();

    const taken = resolved("Cyte-09", { altsTaken: [offer.id] });
    const again = planSteps(taken, { t }).flatMap((step) => step.alts);
    expect(again.find((alt) => alt.id === offer.id)?.taken).toBe(true);
    const line = taken.ledger.find((entry) => entry.currency === currency);
    expect(line?.spent).toBe(priced?.alt?.spends[0].value);
    expect(line?.paired).toBe(false);
    expect(source("PlanSteps.svelte")).toContain("onclick={() => controls.onTakeAlt(alt.id)}");
  });

  it("puts the map on the step whose group has one, disabled until it ships", () => {
    const plan = resolved("AX-52");
    const mapped = plan.groups.filter((entry) => entry.map !== null);
    expect(mapped.length).toBeGreaterThan(0);
    const steps = planSteps(plan, { t });
    for (const entry of mapped) {
      expect(steps.find((step) => step.id === entry.id)?.map).toEqual({
        key: entry.map,
        ready: false,
      });
    }
    const text = source("PlanSteps.svelte");
    expect(text).toContain("{#if controls && step.map}");
    expect(text).toContain("onclick={() => controls.onOpenMap(map)}");
    expect(text).toContain('$tr("nextUp.planMapMissing", { map })');
    const page = source("AcquisitionPlanPage.svelte");
    expect(page).toContain("onOpenMap: (map) => (openMap = map)");
    expect(page).toContain("<FarmMapModal {plan} mapKey={openMap}");
  });

  it("keeps a material step ticked this visit rather than dropping it from under the cursor", () => {
    const material = (rows: ResolvedRow[]) => ({
      ...resolved("Rhino"),
      groups: [group("m0", rows, null), group("1", [row("x", false, "authored")], null)],
    });
    const covered = material([row("inv", true, "inventory")]);
    expect(planSteps(covered, { t }).map((step) => step.id)).toEqual(["1"]);

    const open = material([row("inv", false, "inventory")]);
    const view = withRowOverrides(open, tickPlanRow(open, {}, "inv", true, vi.fn()));
    expect(planSteps(view, { t }).map((step) => step.id)).toEqual(["m0", "1"]);
  });
});

describe("standing on the plan", () => {
  it("names the days a standing currency needs once, on whoever banks it", () => {
    const carriers = resolved("Hound").groups.filter((entry) =>
      entry.facts.some((fact) => fact.kind === "standing"),
    );
    // Solaris United and Entrati each have an earner, so one group each:
    // whoever banks it, never the vendors that spend it. Ostron, which only the
    // Cetus refining blueprint costs, has no earner, so it sits on that vendor.
    expect(carriers.map((entry) => entry.activity)).toEqual([
      "Conservation, plus Bounty 1 for the bonds",
      "Entrati standing for the rank-ups and the blueprint",
      "buy the blueprint",
    ]);
  });

  it("leaves the banked line off a group whose own rows name that currency", () => {
    const banks = resolved("Hound").groups.filter((entry) => entry.earns !== null);
    // The Orb Vallis group's own row names Solaris United standing; the Entrati
    // group's rows are its rank-ups, so it keeps its banked line.
    expect(banks.map((entry) => entry.earns?.currency)).toEqual(["Entrati Standing"]);
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
});

describe("build totals under the parts", () => {
  it("carries the crafting tree's totals and used-for list, collapsed, after PARTS", () => {
    const body = nextup("AcquisitionBody.svelte");
    expect(body).toContain("computeCraftingSummary(tree)");
    expect(body).toContain("buildCraftingTree(root, $itemDb, $componentOwnership)");
    const parts = body.indexOf("<AcquisitionTree");
    const totals = body.indexOf("data-build-totals");
    expect(totals).toBeGreaterThan(parts);
    expect(totals).toBeLessThan(body.indexOf("{@render extra?.()}"));
    const block = body.slice(totals, body.indexOf("</details>", totals));
    for (const shown of [
      "build.summary.totalCredits",
      "build.summary.minBuildTime",
      "build.summary.maxBuildTime",
      "build.usedFor as usage",
      "data-build-used-for",
    ]) {
      expect(block).toContain(shown);
    }
    expect(body).toMatch(/<details class="text-xs" data-build-totals>/);
    expect(body).not.toMatch(/<details[^>]*\bopen\b/);
    for (const key of ["nextUp.buildTotals", "nextUp.buildMinTime", "nextUp.buildMaxTime"]) {
      expect(en).toHaveProperty(key);
    }
  });
});
