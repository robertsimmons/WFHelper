import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

async function buildInventory(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const db = (await window.api.getItemDatabase()) as unknown as Record<string, unknown>;
    const misc: Array<{ ItemType: string; ItemCount: number }> = [];
    for (const uniqueName of Object.keys(db)) {
      if (/VoidProjection/i.test(uniqueName)) misc.push({ ItemType: uniqueName, ItemCount: 3 });
    }
    return { Suits: [], XPInfo: [], MiscItems: misc } as Record<string, unknown>;
  });
}

async function order(page: Page, category: string): Promise<string[]> {
  return page
    .locator(`[data-suggestion-card="${category}"]`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
}

test("a section sort control reorders its cards", async () => {
  test.setTimeout(5 * 60_000);

  let prep: ElectronTestHarness | undefined;
  let inventory: Record<string, unknown>;
  try {
    prep = await launchElectronTestHarness("wfh-sortcheck-prep-", { inventory: { Suits: [] } });
    inventory = await buildInventory(prep.page);
  } finally {
    await closeElectronTestHarness(prep);
  }

  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-sortcheck-", { inventory });
    const page = harness.page;
    await setLayoutViewport(page, 1600, 1000);
    await page.locator('#sidebar [data-view="nextUp"]').click();
    await expect(page.locator("[data-suggestion-card]").first()).toBeVisible({ timeout: 60_000 });
    // Relics need a live fissure, so the section is only there when world state is.
    await page
      .locator('[data-suggestion-section="relics"]')
      .waitFor({ timeout: 30_000 })
      .catch(() => undefined);
    await page.waitForTimeout(2000);

    for (const [section, category] of [
      ["relics", "relics"],
      ["acquisition", "acquisition"],
    ] as const) {
      const controls = page.locator(`[data-suggestion-section="${section}"] .sort-control`);
      if ((await controls.count()) === 0) {
        console.log(`  SKIP ${section}: no section on screen`);
        continue;
      }
      const before = await order(page, category);
      await controls.locator(".sort-control-direction").click();
      await page.waitForTimeout(800);
      const after = await order(page, category);
      console.log(`  ${section} before: ${before.join(" | ")}`);
      console.log(`  ${section} after:  ${after.join(" | ")}`);
      expect(before.length).toBeGreaterThan(1);
      expect(after).not.toEqual(before);
    }
  } finally {
    await closeElectronTestHarness(harness);
  }
});
