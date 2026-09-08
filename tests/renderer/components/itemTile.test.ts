/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Vitest has no Svelte plugin, so the components are read as source. Resolved
// from this file rather than the cwd, which in a worktree is the other checkout.
const COMPONENTS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "components",
);

const tile = (): string =>
  fs.readFileSync(path.join(COMPONENTS, "nextup", "ItemTile.svelte"), "utf8");

function svelteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(full);
    return entry.name.endsWith(".svelte") ? [full] : [];
  });
}

/** Every `<ItemTile ...>` opening tag anywhere a component draws one. */
function itemTileTags(): string[] {
  return svelteFiles(COMPONENTS)
    .filter((file) => path.basename(file) !== "ItemTile.svelte")
    .flatMap((file) => [...fs.readFileSync(file, "utf8").matchAll(/<ItemTile\b[^>]*>/g)])
    .map((match) => match[0]);
}

/** Prose may say "worth"; only code naming it is the failure this file guards. */
function code(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ItemTile", () => {
  it("never renders worth, in a label or in a border", () => {
    const text = code(tile());
    // Worth is what the player configured in settings; the plan's vocabulary
    // table has it appearing in the UI never. The tier letter is the only
    // rating a tile draws.
    for (const gone of ["WORTH_LABEL", "WORTH_TONE", "WORTH_BORDER", "RewardWorth", "worth"]) {
      expect(text).not.toContain(gone);
    }
    expect(text).toContain("TIER_BORDER");
  });

  it("is never handed a worth to draw", () => {
    const tags = itemTileTags();
    expect(tags.length).toBeGreaterThan(1);
    expect(tags.filter((tag) => /\bworth[=\s]/.test(tag))).toEqual([]);
  });

  it("keeps green for a count the player actually has", () => {
    // Green says "you have some", so a zero reads muted rather than as
    // reassurance; the count itself still draws, for the `x0/3` case.
    expect(tile()).toContain('owned.owned > 0 ? "text-success" : "text-text-muted"');
    expect(tile()).toContain("x{compactCount(owned.owned)}");
  });

  it("holds the tier column whether or not the item is rated", () => {
    expect(tile()).toContain("<TierBadge {tier} {size} />");
  });
});
