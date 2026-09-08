import fs from "node:fs";
import path from "node:path";

import { test, expect, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  writeHarnessInventory,
  type ElectronTestHarness,
} from "./electronTestHarness";

const OUT_DIR = process.env.WFH_SHOTS_OUT ?? "C:/Users/rober/.claude/robotron/scratch/nextup-shots";

/** Wide enough for a full row of the 200px cards the narrow sections draw, and
 *  the height `grid.ts` sizes a page for. */
const VIEWPORT = { width: 1600, height: 1000 };

/** Matches `nextup-perf.spec.ts`, so the sections carry the same synthetic account. */
const OWNED_PERCENT = 70;
const PART_RANKED_PERCENT = 15;

const SETTINGS_TABS = ["Value", "Mission types", "Activities", "Nightwave acts", "Tier"] as const;

/** The Nightwave Cred shop's always-available tier, which is the only slice of
 *  it any provider speaks about; every other vendor card is somebody else's. */
const NIGHTWAVE_TITLES = ["Orokin Catalyst", "Orokin Reactor", "Nitain Extract", "Vauban"];

const written: string[] = [];
const missing: string[] = [];

async function shootPage(page: Page, name: string): Promise<void> {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  written.push(file);
}

/** The app scales the whole document by a zoom derived from the display, so
 *  Playwright's own element clip lands short and offset. A full-viewport shot is
 *  in device pixels and the crop is scaled back onto it by hand. */
async function shootElement(page: Page, target: Locator, name: string): Promise<void> {
  await target.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const rect = await target.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, view: window.innerWidth };
  });
  const shot = sharp(await page.screenshot());
  const meta = await shot.metadata();
  const imageWidth = meta.width ?? rect.view;
  const imageHeight = meta.height ?? 0;
  const scale = imageWidth / rect.view;
  const left = Math.max(0, Math.round(rect.x * scale));
  const top = Math.max(0, Math.round(rect.y * scale));
  const file = path.join(OUT_DIR, `${name}.png`);
  await shot
    .extract({
      left,
      top,
      width: Math.min(Math.round(rect.width * scale), imageWidth - left),
      height: Math.min(Math.round(rect.height * scale), imageHeight - top),
    })
    .toFile(file);
  written.push(file);
}

interface OwnedRow {
  ItemType: string;
  ItemCount?: number;
}

type SyntheticInventory = Record<string, OwnedRow[]> & {
  XPInfo: Array<{ ItemType: string; XP: number }>;
};

/** The same deterministic slice of the shipped item database the perf spec owns,
 *  plus a relic shelf, so relics has stock whenever a fissure is up. */
async function buildInventory(page: Page): Promise<SyntheticInventory> {
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

      const bucket = (text: string): number => {
        let hash = 0x811c9dc5;
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash % 100;
      };

      const inventory: Record<string, unknown[]> = { XPInfo: [], MiscItems: [] };
      for (const key of collections) inventory[key] = [];
      const xp = inventory.XPInfo as Array<{ ItemType: string; XP: number }>;
      const misc = inventory.MiscItems as Array<{ ItemType: string; ItemCount: number }>;

      for (const [uniqueName, entry] of Object.entries(db)) {
        if (/VoidProjection/i.test(uniqueName)) misc.push({ ItemType: uniqueName, ItemCount: 3 });
        if (!entry?.name || entry.masterable !== true) continue;
        if (entry.exalted === true || entry.isBuildComponent === true) continue;
        const category = String(entry.productCategory ?? "");
        if (!collections.includes(category)) continue;
        if (excluded.test(uniqueName)) continue;
        const slot = bucket(uniqueName);
        if (slot >= arg.ownedPercent) continue;
        (inventory[category] as unknown[]).push({ ItemType: uniqueName });
        xp.push({ ItemType: uniqueName, XP: slot < arg.partRankedPercent ? 40_000 : 900_000 });
      }

      return inventory as never;
    },
    { ownedPercent: OWNED_PERCENT, partRankedPercent: PART_RANKED_PERCENT },
  );
}

async function closeModal(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]');
  await page.keyboard.press("Escape");
  if ((await dialog.count()) === 0) return;
  await dialog.first().locator(".detail-backdrop").click();
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
}

/** A card that is not on screen is a finding about the feed, not a failure, so
 *  the shot is recorded as missing and the walk carries on. */
async function captureDetails(page: Page, name: string, card: Locator): Promise<void> {
  if ((await card.count()) === 0) {
    missing.push(`${name}: no such card in the feed`);
    return;
  }
  const title = (await card.first().getAttribute("aria-label")) ?? "";
  await card.first().click();
  const panel = page.locator('[role="dialog"] .detail-panel');
  try {
    await panel.first().waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    missing.push(`${name}: card clicked but no details modal opened`);
    return;
  }
  await page.waitForTimeout(500);
  await shootElement(page, panel.first(), name);
  console.log(`  ${name}: ${title}`);
  await closeModal(page);
}

interface CardFace {
  label: string;
  category: string;
  choices: boolean;
}

async function faces(page: Page, section: string): Promise<CardFace[]> {
  return page
    .locator(`[data-suggestion-section="${section}"] [data-suggestion-card]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute("aria-label") ?? "",
        category: node.getAttribute("data-suggestion-card") ?? "",
        choices: node.querySelector(".choice-name") !== null,
      })),
    );
}

/** Only one page of a section is mounted, so a card the shot wants is found by
 *  walking the pager from the first page rather than by querying the whole feed. */
async function findCard(
  page: Page,
  section: string,
  match: (face: CardFace) => boolean,
): Promise<Locator | null> {
  const prev = page.locator(`[data-section-page-prev="${section}"]`);
  const next = page.locator(`[data-section-page-next="${section}"]`);
  if ((await page.locator(`[data-suggestion-section="${section}"]`).count()) === 0) return null;
  for (let step = 0; step < 40 && (await prev.count()) > 0 && (await prev.isEnabled()); step += 1) {
    await prev.click();
    await page.waitForTimeout(120);
  }
  for (let step = 0; step < 40; step += 1) {
    const found = (await faces(page, section)).findIndex(match);
    if (found >= 0) {
      return page
        .locator(`[data-suggestion-section="${section}"] [data-suggestion-card]`)
        .nth(found);
    }
    if ((await next.count()) === 0 || !(await next.isEnabled())) return null;
    await next.click();
    await page.waitForTimeout(150);
  }
  return null;
}

function isNightwave(face: CardFace): boolean {
  return NIGHTWAVE_TITLES.some((title) => face.label.includes(title));
}

test("Next Up screenshots: every section, a details modal per card shape and every settings tab", async () => {
  test.setTimeout(15 * 60_000);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-nextup-shots-", { inventory: { Suits: [] } });
    const page = harness.page;
    await setLayoutViewport(page, VIEWPORT.width, VIEWPORT.height);

    writeHarnessInventory(harness, await buildInventory(page));
    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    await setLayoutViewport(page, VIEWPORT.width, VIEWPORT.height);

    await openView(page, "nextUp");
    await expect(page.locator("[data-suggestion-card]").first()).toBeVisible({ timeout: 90_000 });
    // Relics, Nightwave and the vendors all wait on world state, which arrives
    // after the first cards do.
    await page
      .locator('[data-suggestion-section="relics"]')
      .waitFor({ timeout: 45_000 })
      .catch(() => undefined);
    await page.waitForTimeout(4000);

    for (const id of ["tasks", "relics", "acquisition", "mastery"] as const) {
      const section = page.locator(`[data-suggestion-section="${id}"]`);
      const count = await section.count();
      console.log(
        `  section ${id}: ${count === 0 ? "NOT RENDERED" : `${await section.getAttribute("data-section-count")} suggestions, ${await section.locator("[data-suggestion-card]").count()} on the page`}`,
      );
    }

    await shootPage(page, "01-nextup-whole-tab");

    for (const id of ["tasks", "relics", "acquisition", "mastery"] as const) {
      const section = page.locator(`[data-suggestion-section="${id}"]`);
      if ((await section.count()) === 0) {
        missing.push(`section ${id}: never rendered - the feed produced no cards for it`);
        continue;
      }
      await shootElement(page, section, `02-section-${id}`);
    }

    const firstTaskCard = page.locator('[data-suggestion-section="tasks"] [data-suggestion-card]');
    if ((await firstTaskCard.count()) > 0) {
      await shootElement(page, firstTaskCard.first(), "03-tasks-card-closeup");
    } else {
      missing.push("tasks card close-up: the Tasks section has no cards");
    }

    const circuit = await findCard(page, "tasks", (face) => face.choices);
    await captureDetails(page, "04-details-circuit-choice-strips", circuit ?? page.locator("nope"));

    const acquisition = await findCard(page, "acquisition", () => true);
    await captureDetails(page, "05-details-acquisition", acquisition ?? page.locator("nope"));

    const vendor = await findCard(
      page,
      "tasks",
      (face) => face.category === "vendor" && !isNightwave(face),
    );
    await captureDetails(page, "06-details-vendor", vendor ?? page.locator("nope"));

    const nightwave = await findCard(
      page,
      "tasks",
      (face) => face.category === "vendor" && isNightwave(face),
    );
    await captureDetails(page, "07-details-nightwave-cred-shop", nightwave ?? page.locator("nope"));

    await page.locator('.view-header button[aria-label="Suggestion settings"]').click();
    const settings = page.locator('[role="dialog"] .next-up-settings-panel');
    await settings.waitFor({ state: "visible", timeout: 15_000 });
    for (const [index, label] of SETTINGS_TABS.entries()) {
      const tab = settings.getByRole("button", { name: label, exact: true });
      if ((await tab.count()) === 0) {
        missing.push(`settings tab ${label}: no such tab button`);
        continue;
      }
      await tab.first().click();
      await page.waitForTimeout(500);
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await shootElement(page, settings, `08-${index + 1}-settings-${slug}`);
    }
    await closeModal(page);
  } finally {
    await closeElectronTestHarness(harness);
  }

  console.log("\n=== PNGs written ===");
  for (const file of written) console.log(`  ${file}`);
  if (missing.length > 0) {
    console.log("\n=== NOT captured ===");
    for (const note of missing) console.log(`  ${note}`);
  }

  expect(written.length).toBeGreaterThan(0);
});
