/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { en } from "../../../src/i18n/en.js";
import { RELIC_GOALS } from "../../../src/types/suggest.js";

// Vitest has no Svelte plugin, so the component is read as source. Resolved
// from this file rather than the cwd, which in a worktree is the other checkout.
const CONTROLS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "components",
  "nextup",
  "controls",
  "RelicsControls.svelte",
);

const source = (): string => fs.readFileSync(CONTROLS, "utf8");

describe("RelicsControls", () => {
  it("labels every goal, MR included", () => {
    const text = source();
    for (const key of RELIC_GOALS) {
      expect(text).toMatch(new RegExp(`^\\s+${key}: "[\\w.]+",$`, "m"));
    }
    expect(text).toContain('mr: "nextUp.relicGoalMr"');
    expect(en).toHaveProperty(["nextUp.relicGoalMr"]);
  });

  it("orders by the goal alone, with one picker and its arrow", () => {
    const text = source();
    expect(text).toContain("value={options.relicGoal}");
    expect(text).toContain("onSelect={pickGoal}");
    expect(text).toContain("direction={options.relicSortDir}");
    expect(text).not.toContain('"relicSort"');
    expect(text).not.toContain("recommended");
  });
});
