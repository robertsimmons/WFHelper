/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { en } from "../../../src/i18n/en.js";

// Vitest has no Svelte plugin, so the components are read as source. Resolved
// from this file rather than the cwd, which in a worktree is the other checkout.
const NEXTUP = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "components",
  "nextup",
);

const tree = (): string => fs.readFileSync(path.join(NEXTUP, "AcquisitionTree.svelte"), "utf8");
const body = (): string => fs.readFileSync(path.join(NEXTUP, "AcquisitionBody.svelte"), "utf8");
const modal = (): string =>
  fs.readFileSync(path.join(NEXTUP, "SuggestionDetailsModal.svelte"), "utf8");

describe("acquisition tree", () => {
  it("counts what the player holds off the never-depleted ownership map", () => {
    const text = tree();
    expect(text).toContain("buildCraftingTree(root, $itemDb, $componentOwnership, OPTIONS)");
    // The resolver's own part rows are drained by a shared allocation pool, so
    // a count read off them reads as zero held.
    for (const drained of ["target.parts.materials", "target.parts.components", "parts.main"]) {
      expect(text).not.toContain(drained);
    }
  });

  it("keeps every part closed until the player opens it", () => {
    const text = tree();
    expect(text).toContain("{@const open = opened.get(path) ?? false}");
    expect(text).toContain("onclick={() => opened.set(path, !open)}");
    expect(text).toContain("aria-expanded={open}");
  });

  it("draws a name and a have/need count, nothing else", () => {
    const text = tree();
    for (const absent of [
      "formatBuildTime",
      "buildPrice",
      "buildTime",
      "creditsShort",
      "nextUp.treeInOrder",
      "nextUp.treeInParallel",
      "nextUp.treePerCraft",
      "acqPlatEach",
      "computeCraftingSummary",
    ]) {
      expect(text).not.toContain(absent);
    }
    expect(text).toContain("{formatNumber(node.owned)}/{formatNumber(node.count)}");
  });

  it("lists the parts the plan builds that the recipe does not", () => {
    const text = tree();
    expect(text).toContain("planOnlyParts(plan, tree, $itemDb)");
    expect(text).toContain("partLeaf(part)");
  });

  it("stands the flat part and material lists down once it has a root", () => {
    const text = modal();
    expect(text).toMatch(/<AcquisitionBody\s+\{plan\}\s+root=\{treeRoot\}/);
    expect(body()).toContain("<AcquisitionTree {root} {plan} />");
    // Nothing is cut when there is no recipe to walk: the old lists stay as the
    // fallback, which is also what keeps their labels honest.
    expect(text).toContain("{#if partTiles.length > 0 && !treeRoot}");
    expect(text).toContain("{#if materialTiles.length > 0 && !treeRoot}");
  });

  it("names every key it resolves", () => {
    const keys = [...tree().matchAll(/\$tr\(\s*"([\w.]+)"/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !(key in en))).toEqual([]);
  });
});
