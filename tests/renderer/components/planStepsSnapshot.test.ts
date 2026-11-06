import { beforeAll, describe, expect, it } from "vitest";

import type { PlanModel } from "../../../src/components/nextup/plan/planSteps.js";
import * as itemDatabase from "../../../services/itemDatabase";
import type { ItemDbEntry, RawInventoryData } from "../../../src/types/inventory.js";
import { authoredStateModel, PLAN_FILES, planLines, renderSteps } from "./planText.js";

const STATES: { label: string; inventory: RawInventoryData | null }[] = [
  { label: "no inventory read", inventory: null },
  { label: "inventory read, owns nothing", inventory: {} },
];

let itemDb: Record<string, ItemDbEntry> = {};

beforeAll(() => {
  itemDatabase.buildDatabase();
  itemDb = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
});

/** Chips that break the pickup rule: one repeating its line's title or another chip. */
function repeatedChips(steps: PlanModel): string[] {
  return planLines(steps).flatMap((entry) => {
    const labels = entry.parts.map((part) => part.label.toLowerCase());
    return labels
      .filter(
        (label, index) => label === entry.title.toLowerCase() || labels.indexOf(label) !== index,
      )
      .map((label) => `${entry.title}: ${label}`);
  });
}

describe("plan step screens", () => {
  it.each(PLAN_FILES)("$file", async ({ file, plan }) => {
    const models = STATES.map((state) => authoredStateModel(plan, itemDb, state.inventory));
    for (const steps of models) expect(repeatedChips(steps)).toEqual([]);
    const text = STATES.map(
      (state, index) => `== ${plan.name}, ${state.label} ==\n${renderSteps(models[index])}\n`,
    ).join("\n");
    await expect(text).toMatchFileSnapshot(`./__plan-steps__/${file}.txt`);
  });
});
