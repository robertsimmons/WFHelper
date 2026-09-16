/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { en } from "../../../src/i18n/en.js";

// Vitest has no Svelte plugin, so the modal is read as source. Resolved from
// this file rather than the cwd, which in a worktree is the other checkout.
const MODAL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "components",
  "nextup",
  "SuggestionDetailsModal.svelte",
);

const source = (): string => fs.readFileSync(MODAL, "utf8");

/** Every `<ItemTile ...>` opening tag in the modal. */
function itemTileTags(): string[] {
  return [...source().matchAll(/<ItemTile\b[^>]*>/g)].map((match) => match[0]);
}

describe("suggestion details modal", () => {
  it("gives every named item a tier", () => {
    // The reward's own letter is the header's: the two share a column, so a
    // tier on that one tile would draw the same letter twice, stacked.
    expect(source()).toContain('<TierBadge tier={headerTier} size="md" />');
    const untiered = itemTileTags()
      .filter((tag) => !/\bname=\{rewardTile\.name\}/.test(tag))
      .filter((tag) => !/\btier=/.test(tag));
    expect(untiered).toEqual([]);
    expect(itemTileTags().length).toBeGreaterThan(1);
  });

  it("draws item names through a tile, never as a joined sentence", () => {
    const text = source();
    for (const joined of ["pool.join", "warframes.join", "covers.join"]) {
      expect(text).not.toContain(joined);
    }
  });

  it("draws every win a choice can bank, not one chip standing for both", () => {
    const text = source();
    // One state could never say whether a frame is mastered AND whether it has
    // been fed to the Helminth, so the modal draws the list of wins instead.
    expect(text).toContain("statuses={choice.statuses}");
    expect(text).not.toContain("<StateChip");
    for (const key of ["nextUp.choiceTakeIt", "nextUp.choiceSubsumeOnly"]) {
      expect(text).not.toContain(key);
    }
  });

  it("marks what the player already owns on the tile, not in a chip beside it", () => {
    const text = source();
    expect(text).toContain("have: ownsAny(owned)");
    expect(text).toContain('have: row.verdict === "done"');
  });

  it("rates the acquisition target once, on its tile", () => {
    expect(source()).not.toContain("nextUp.acqRank");
  });

  it("tells the reader no valence window", () => {
    expect(source()).not.toContain("nextUp.acqNemesisBonus");
  });

  it("labels a bare count with what it counts", () => {
    const text = source();
    expect(text).not.toContain('"nextUp.detailsProgress"');
    // Mastery has no honest word for its count - `rank` is not vocabulary - so
    // it draws no row rather than borrowing one.
    expect(text).not.toContain("common.rank");
    for (const key of ["nextUp.detailsRuns", "nextUp.acqParts"]) {
      expect(en).toHaveProperty(key);
      expect(text).toContain(key);
    }
    // No category is labelled by default: one without an honest word draws no row.
    expect(text).toContain("Partial<Record<SuggestionCategory, MessageKey>>");
    expect(text).toContain("{#if progress && progressLabel && !acq}");
  });

  it("calls no Cred-shop purchase a run", () => {
    const text = source();
    // The shop files its cards under `vendor` like the stalls, so the row the
    // provider parked is the only thing that tells them apart.
    expect(text).toContain("nightwaveRowFor(suggestion.id)");
    expect(text).not.toMatch(/^\s*vendor: "nextUp\.detailsRuns",$/m);
    // A staple's shortfall is already the first thing the why line says.
    expect(text).toMatch(/stock:\s*null,/);
  });

  it("reads vendor stock off the resolved rows, not an inventory-less rebuild", () => {
    const text = source();
    expect(text).toContain("valenceRowsFor(suggestion.id)");
    for (const gone of ["valenceOffers(", "valenceDoc()"]) {
      expect(text).not.toContain(gone);
    }
  });

  it("draws the roll, what is held and what a purchase makes", () => {
    const text = source();
    // The player's own roll rides the tile beside their count; only what a
    // purchase would leave the weapon at needs a word of its own.
    expect(text).not.toContain("nextUp.valenceYours");
    expect(text).toContain("ownedBonus={row.ownedBonus}");
    expect(en).toHaveProperty("nextUp.valenceAfter");
    expect(text).toContain("nextUp.valenceAfter");
    // An unowned weapon has no percentage, and must never print one.
    expect(text).toContain("owned: row.owned === null ? null : tile.owned");
    // The verdict tones a figure and dims a finished row; it is never a sentence.
    expect(text).toContain('row.verdict === "done"');
    expect(text).not.toContain("VERDICT_LABEL");
  });

  it("keeps the curated stock as the fallback when no rows resolved", () => {
    // Off the clock, so a rotating stall lists what it holds now rather than
    // every colour it ever holds.
    expect(source()).toContain("liveVendorOffers(taskId, $cardClock)");
  });

  it("draws every payday the provider hands it, and every pick on each", () => {
    const text = source();
    expect(text).toContain("const options = $derived(details?.options ?? []);");
    expect(text).toMatch(/#each optionTiles as group/);
    expect(text).toMatch(/#each group\.tiles as tile/);
    // The card's line is the one that clamps; a cap here hides half a season.
    expect(text).not.toMatch(/\boptions\s*\.slice\(/);
    expect(text).not.toMatch(/\boptionTiles\s*\.slice\(/);
  });

  it("names every key it resolves", () => {
    const keys = [...source().matchAll(/\$tr\(\s*"([\w.]+)"/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !(key in en))).toEqual([]);
  });
});
