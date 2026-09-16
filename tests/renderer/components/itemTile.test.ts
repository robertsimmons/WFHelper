/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { tierBorderClass, tileCounts, winChip } from "../../../src/components/nextup/chips.js";

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
    // The one thing that may colour the frame is the tier, through the shared
    // ramp; every letter gets its own colour and an unrated item the plain one.
    expect(text).toContain("tierBorderClass(tier)");
    expect(tierBorderClass("S")).not.toBe(tierBorderClass("A"));
    expect(tierBorderClass(null)).toBe("border-border");
  });

  it("is never handed a worth to draw", () => {
    const tags = itemTileTags();
    expect(tags.length).toBeGreaterThan(1);
    expect(tags.filter((tag) => /\bworth[=\s]/.test(tag))).toEqual([]);
  });

  it("keeps green for a count the player actually has", () => {
    // Green says "you have some", so a zero reads muted rather than as
    // reassurance; the count itself still draws, for the `x0/3` case.
    const [none] = tileCounts({ owned: 0 });
    const [some] = tileCounts({ owned: 3 });
    expect(none?.tone).toBe("text-text-muted");
    expect(none?.value).toBe(0);
    expect(some?.tone).toBe("text-success");
    expect(tile()).toContain("x{compactCount(count.value)}");
  });

  it("says each win in words, not in colour alone", () => {
    const mastered = winChip({ win: "mastery", done: true });
    const unmastered = winChip({ win: "mastery", done: false });
    expect(mastered.label).toBe("common.mastered");
    expect(unmastered.label).toBe("common.notMastered");
    expect(mastered.tone).not.toBe(unmastered.tone);
    expect(winChip({ win: "subsume", done: true }).label).toBe("common.subsumed");
    expect(winChip({ win: "subsume", done: false }).label).toBe("filters.notSubsumed");
  });

  it("keeps a tile readable once every win on it is banked", () => {
    // A finished choice used to fade out, which is exactly where the reader
    // asked to still be able to tell the two wins apart.
    expect(tile()).toContain("(statuses ?? []).length === 0 && tileDims(have, stacks, owned)");
    expect(tile()).toContain("{#each wins as win (win.status.win)}");
  });

  it("holds the tier column whether or not the item is rated", () => {
    // The badge draws nothing for an unrated item, so the fixed box around it
    // is what keeps the letters of a list in one column.
    const text = tile();
    expect(text).toContain('const SLOT = { sm: "w-7", md: "w-8" };');
    expect(text).toMatch(/class="flex shrink-0 justify-center \{SLOT\[size\]\}">\s*<TierBadge\b/);
    expect(text).toMatch(/\{ART\[size\]\}"\s*>[\s\S]*?<TierBadge\b/);
  });
});
