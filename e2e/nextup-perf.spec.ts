import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const RUNS = Number(process.env.WFH_PERF_RUNS ?? 5);
const OUT_FILE =
  process.env.WFH_PERF_OUT ?? "C:/Users/rober/.claude/robotron/scratch/nextup-perf-baseline.md";

/** Share of masterable gear the synthetic account already owns. */
const OWNED_PERCENT = 70;
/** Of that owned gear, the share left part-ranked so Mastery still has cards. */
const PART_RANKED_PERCENT = 15;

const KIND_TOGGLE_ORDER = ["companion", "archwing", "melee", "secondary", "primary"] as const;

// --------------------------------------------------------------------------
// BUDGET ASSERTIONS GO HERE. Nothing is asserted yet - this spec exists to
// find out what "good" is. Once a target lands, gate on the medians, e.g.
//   expect(summary.reentry.median).toBeLessThan(REENTRY_BUDGET_MS);
// --------------------------------------------------------------------------

interface Sample {
  /** Click to the frame after the cards are on screen. */
  elapsedMs: number;
  /** Main thread blocked inside the click handler itself. */
  syncMs: number;
  /** Long-task time attributed by the browser during the measured window. */
  blockedMs: number;
  /** A two-frame wait taken immediately before, with nothing happening. */
  idleMs: number;
  cards: number;
}

interface Stat {
  median: number;
  max: number;
  runs: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function stat(samples: readonly Sample[], pick: (sample: Sample) => number): Stat {
  const values = samples.map(pick);
  return {
    median: Math.round(median(values)),
    max: Math.round(Math.max(0, ...values)),
    runs: values.length,
  };
}

/**
 * Every number here is taken inside the renderer: the clock starts on the
 * synthetic click and stops two frames after the cards exist, so nothing in it
 * is Playwright's CDP round trip. `idleMs` is the control - an unblocked
 * two-frame wait is ~32ms, and anything far above that means the window was
 * throttled and the run should not be trusted.
 */
async function measure(
  page: Page,
  action: { type: "nav" } | { type: "toggle"; kind: string },
): Promise<Sample> {
  return page.evaluate(async (arg) => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const painted = async () => {
      await frame();
      await frame();
    };

    let blockedMs = 0;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) blockedMs += entry.duration;
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      observer = null;
    }

    const idleStart = performance.now();
    await painted();
    const idleMs = performance.now() - idleStart;

    const selector =
      arg.type === "nav"
        ? '#sidebar [data-view="nextUp"]'
        : `[data-acquisition-kind="${arg.kind}"]`;
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) throw new Error(`perf target missing: ${selector}`);

    observer?.takeRecords();
    blockedMs = 0;

    const start = performance.now();
    target.click();
    const syncMs = performance.now() - start;

    if (arg.type === "nav") {
      const deadline = performance.now() + 60_000;
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (document.querySelector("[data-suggestion-card]")) resolve();
          else if (performance.now() > deadline) reject(new Error("no suggestion card ever painted"));
          else requestAnimationFrame(tick);
        };
        tick();
      });
    }
    await painted();
    const elapsedMs = performance.now() - start;

    if (observer) {
      for (const entry of observer.takeRecords()) blockedMs += entry.duration;
      observer.disconnect();
    }

    return {
      elapsedMs,
      syncMs,
      blockedMs,
      idleMs,
      cards: document.querySelectorAll("[data-suggestion-card]").length,
    };
  }, action);
}

interface OwnedRow {
  ItemType: string;
  ItemCount?: number;
}

type SyntheticInventory = Record<string, OwnedRow[]> & {
  XPInfo: Array<{ ItemType: string; XP: number }>;
};

interface FixtureBuild {
  inventory: SyntheticInventory;
  masterable: number;
  owned: number;
}

/**
 * No committed fixture covers a lived-in account, so one is derived from the
 * shipped item database: a deterministic share of every masterable frame and
 * weapon is marked owned, which is what decides how much gear the acquisition
 * sweep still has to plan a route for.
 */
async function buildInventory(page: Page): Promise<FixtureBuild> {
  return page.evaluate(
    async (arg) => {
      const db = (await window.api.getItemDatabase()) as unknown as Record<
        string,
        {
          name?: string;
          masterable?: boolean;
          exalted?: boolean;
          isBuildComponent?: boolean;
          productCategory?: string;
        }
      >;

      const collections = [
        "Suits",
        "LongGuns",
        "Pistols",
        "Melee",
        "SpaceGuns",
        "SpaceMelee",
        "SentinelWeapons",
        "Sentinels",
      ];
      const excluded = /\/(?:Recipes|StoreItems|QuestVersions|PrototypeVersions|Test)\//i;

      // FNV-1a, so the same account comes back on every run and every machine.
      const bucket = (text: string): number => {
        let hash = 0x811c9dc5;
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash % 100;
      };

      const inventory: Record<string, unknown[]> = { XPInfo: [] };
      for (const key of collections) inventory[key] = [];
      const xp = inventory.XPInfo as Array<{ ItemType: string; XP: number }>;

      let masterable = 0;
      let owned = 0;
      for (const [uniqueName, entry] of Object.entries(db)) {
        if (!entry?.name || entry.masterable !== true) continue;
        if (entry.exalted === true || entry.isBuildComponent === true) continue;
        const category = String(entry.productCategory ?? "");
        if (!collections.includes(category)) continue;
        if (excluded.test(uniqueName)) continue;
        masterable += 1;
        const slot = bucket(uniqueName);
        if (slot >= arg.ownedPercent) continue;
        owned += 1;
        (inventory[category] as unknown[]).push({ ItemType: uniqueName });
        xp.push({ ItemType: uniqueName, XP: slot < arg.partRankedPercent ? 40_000 : 900_000 });
      }

      return { inventory: inventory as never, masterable, owned };
    },
    { ownedPercent: OWNED_PERCENT, partRankedPercent: PART_RANKED_PERCENT },
  );
}

const VIEWPORT = { width: 1600, height: 1000 };

async function leaveNextUp(page: Page): Promise<void> {
  await page.locator('#sidebar [data-view="inventory"]').click();
  await expect(page.locator("[data-suggestion-card]")).toHaveCount(0, { timeout: 30_000 });
}

function headSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function row(name: string, value: Stat): string {
  return `| ${name} | ${value.median} | ${value.max} | ${value.runs} |`;
}

function describeSamples(name: string, samples: readonly Sample[]): string {
  const each = samples
    .map(
      (sample) =>
        `elapsed ${Math.round(sample.elapsedMs)}ms / sync ${Math.round(sample.syncMs)}ms / ` +
        `longtask ${Math.round(sample.blockedMs)}ms / idle-control ${Math.round(sample.idleMs)}ms / ` +
        `${sample.cards} cards`,
    )
    .join("\n    ");
  return `  ${name}:\n    ${each}`;
}

test("Next Up render cost: cold, re-entry and acquisition toggle", async () => {
  test.setTimeout(15 * 60_000);

  let prep: ElectronTestHarness | undefined;
  let fixture: FixtureBuild;
  try {
    prep = await launchElectronTestHarness("wfh-nextup-perf-prep-", { inventory: { Suits: [] } });
    fixture = await buildInventory(prep.page);
  } finally {
    await closeElectronTestHarness(prep);
  }
  expect(fixture.owned, "synthetic account owns nothing - fixture is not realistic").toBeGreaterThan(
    100,
  );

  const cold: Sample[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    let harness: ElectronTestHarness | undefined;
    try {
      harness = await launchElectronTestHarness("wfh-nextup-perf-cold-", {
        inventory: fixture.inventory,
      });
      await setLayoutViewport(harness.page, VIEWPORT.width, VIEWPORT.height);
      await expect(harness.page.locator("[data-suggestion-card]")).toHaveCount(0);
      cold.push(await measure(harness.page, { type: "nav" }));
    } finally {
      await closeElectronTestHarness(harness);
    }
  }

  const reentry: Sample[] = [];
  const toggle: Sample[] = [];
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-nextup-perf-warm-", {
      inventory: fixture.inventory,
    });
    const page = harness.page;
    await setLayoutViewport(page, VIEWPORT.width, VIEWPORT.height);

    // First entry is the cold one; the samples that matter come after it.
    await measure(page, { type: "nav" });
    for (let run = 0; run < RUNS; run += 1) {
      await leaveNextUp(page);
      reentry.push(await measure(page, { type: "nav" }));
    }

    await expect(page.locator("[data-acquisition-kind]").first()).toBeVisible({ timeout: 30_000 });
    for (let run = 0; run < RUNS; run += 1) {
      const kind = KIND_TOGGLE_ORDER[run % KIND_TOGGLE_ORDER.length]!;
      toggle.push(await measure(page, { type: "toggle", kind }));
      // Put the box back so every sample starts from the same six-kind state.
      await page.locator(`[data-acquisition-kind="${kind}"]`).click();
      await page.waitForTimeout(200);
    }
  } finally {
    await closeElectronTestHarness(harness);
  }

  const summary = {
    cold: stat(cold, (sample) => sample.elapsedMs),
    reentry: stat(reentry, (sample) => sample.elapsedMs),
    toggle: stat(toggle, (sample) => sample.elapsedMs),
  };

  const lines = [
    "",
    "=== Next Up baseline ===",
    `fixture: synthetic account, ${fixture.owned}/${fixture.masterable} masterable items owned ` +
      `(${OWNED_PERCENT}% deterministic slice of the shipped item database)`,
    `commit: ${headSha()}`,
    "",
    "| scenario | median ms | max ms | runs |",
    "| --- | --- | --- | --- |",
    row("cold (launch -> Next Up -> cards painted)", summary.cold),
    row("re-entry (other tab -> Next Up -> cards painted)", summary.reentry),
    row("acquisition kind toggle (click -> grid repainted)", summary.toggle),
    "",
    describeSamples("cold", cold),
    describeSamples("re-entry", reentry),
    describeSamples("toggle", toggle),
    "",
  ];
  console.log(lines.join("\n"));

  const report = [
    "# Next Up perf baseline",
    "",
    `Commit: \`${headSha()}\``,
    `Fixture: synthetic account generated in \`e2e/nextup-perf.spec.ts\` - a deterministic ` +
      `${OWNED_PERCENT}% slice of the shipped item database marked owned ` +
      `(${fixture.owned} of ${fixture.masterable} masterable frames and weapons). No committed ` +
      "inventory fixture in this repo is larger than a handful of rows.",
    `Viewport: ${VIEWPORT.width}x${VIEWPORT.height} CSS px. Runs per scenario: ${RUNS}.`,
    "",
    "| scenario | median ms | max ms | runs |",
    "| --- | --- | --- | --- |",
    row("Cold (launch -> Next Up -> cards painted)", summary.cold),
    row("Re-entry (other tab -> Next Up -> cards painted)", summary.reentry),
    row("Acquisition kind toggle (click -> grid repainted)", summary.toggle),
    "",
    "Per-run detail (elapsed / sync = blocked inside the click handler / longtask / idle control):",
    "",
    "```",
    describeSamples("cold", cold),
    describeSamples("re-entry", reentry),
    describeSamples("toggle", toggle),
    "```",
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, report, "utf8");

  expect(summary.reentry.runs).toBe(RUNS);
});
