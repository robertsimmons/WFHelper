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
const modal = (): string =>
  fs.readFileSync(path.join(NEXTUP, "SuggestionDetailsModal.svelte"), "utf8");

describe("acquisition tree", () => {
  it("counts what the player holds off the never-depleted ownership map", () => {
    const text = tree();
    expect(text).toContain("buildCraftingTree(root, $itemDb, $componentOwnership)");
    // The resolver's own part rows are drained by a shared allocation pool, so
    // a count read off them reads as zero held.
    for (const drained of ["target.parts.materials", "target.parts.components", "parts.main"]) {
      expect(text).not.toContain(drained);
    }
  });

  it("opens a branch that is short and closes one that is covered", () => {
    const text = tree();
    // The length of the tree is itself the headache read, so nothing the player
    // has finished with takes up a line until they ask for it.
    expect(text).toContain("return opened.get(path) ?? node.missing > 0;");
    expect(text).toContain("onclick={() => toggle(path, node)}");
    expect(text).toContain("aria-expanded={open}");
  });

  it("leaves an unpriced route blank rather than printing a zero", () => {
    const text = tree();
    expect(text).toContain("{#if platSet !== null}");
    expect(text).toContain("{#if platParts !== null}");
    expect(text).not.toMatch(/plat\??\.\s*set\s*\?\?\s*0/);
    expect(text).not.toMatch(/partsTotal\s*\?\?\s*0/);
  });

  it("never invents an in-game market price the app does not hold", () => {
    const text = tree();
    for (const absent of ["platinumCost", "creditsCost", "marketPrice"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("stands the flat part and material lists down once it has a root", () => {
    const text = modal();
    expect(text).toContain("<AcquisitionTree target={acq} root={treeRoot} />");
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
