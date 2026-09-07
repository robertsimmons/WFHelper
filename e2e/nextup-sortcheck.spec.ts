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

async function order(page: Page, section: string, category: string): Promise<string[]> {
  return page
    .locator(`[data-suggestion-section="${section}"] [data-suggestion-card="${category}"]`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
}

/** The header counts every card in the section, paged out or not, so it says
 *  whether a page walk read them all. */
async function sectionTotal(page: Page, section: string): Promise<number> {
  const raw = await page
    .locator(`[data-suggestion-section="${section}"]`)
    .getAttribute("data-section-count");
  return Number(raw ?? 0);
}

/** Only one page of cards is mounted, so the whole order is read by walking the
 *  pager from the first page to the last. */
async function pagedOrder(page: Page, section: string, category: string): Promise<string[]> {
  const prev = page.locator(`[data-section-page-prev="${section}"]`);
  const next = page.locator(`[data-section-page-next="${section}"]`);
  const pages = 40;
  for (let step = 0; step < pages && (await prev.isEnabled()); step += 1) {
    await prev.click();
    await page.waitForTimeout(120);
  }
  const labels: string[] = [];
  for (let step = 0; step < pages; step += 1) {
    labels.push(...(await order(page, section, category)));
    if (!(await next.isEnabled())) break;
    await next.click();
    await page.waitForTimeout(120);
  }
  return labels;
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
      const before = await pagedOrder(page, section, category);
      const beforeTotal = await sectionTotal(page, section);
      await controls.locator(".sort-control-direction").click();
      await page.waitForTimeout(800);
      const after = await pagedOrder(page, section, category);
      const afterTotal = await sectionTotal(page, section);
      console.log(`  ${section} before: ${before.join(" | ")}`);
      console.log(`  ${section} after:  ${after.join(" | ")}`);
      expect(before.length).toBeGreaterThan(1);
      // Both reads cover the whole section, so the comparison is not two
      // different pages of it. A provider caps its list after sorting, so which
      // cards survive the cap is the arrow's to change; their order is the test.
      expect(before.length).toBe(beforeTotal);
      expect(after.length).toBe(afterTotal);
      expect(after).not.toEqual(before);
    }
  } finally {
    await closeElectronTestHarness(harness);
  }
});
