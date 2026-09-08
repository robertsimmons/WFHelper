import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CARD_GAP,
  CARD_MIN_WIDTH,
  cardMinWidthFor,
  clampPage,
  gridTemplateFor,
  pageCountFor,
  pageSizeFor,
} from "../../../../src/lib/suggest/grid.js";
import { SUGGESTION_SECTION_IDS } from "../../../../src/types/suggest.js";

const NARROW_SECTIONS = ["relics", "acquisition", "mastery"] as const;

/** The floor the Mastery and Inventory views lay their cards out on. */
function itemGridFloor(): { minWidth: number; gap: number } {
  // Resolved from this file, not the cwd, which in a worktree is the other checkout.
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const css = fs.readFileSync(path.join(root, "src", "styles", "components.css"), "utf8");
  const block = /\.item-grid,\s*#relic-grid\s*\{([^}]*)\}/.exec(css);
  if (!block) throw new Error("no .item-grid rule in components.css");
  const minWidth = /minmax\((\d+)px/.exec(block[1]!);
  const gap = /gap:\s*([\d.]+)rem/.exec(block[1]!);
  if (!minWidth || !gap) throw new Error(".item-grid rule no longer states a floor and a gap");
  return { minWidth: Number(minWidth[1]), gap: Number(gap[1]) * 16 };
}

function templateFloor(id: (typeof SUGGESTION_SECTION_IDS)[number]): number {
  const match = /^repeat\(auto-fill, minmax\((\d+)px, 1fr\)\)$/.exec(gridTemplateFor(id));
  if (!match) throw new Error(`unreadable grid template for ${id}: ${gridTemplateFor(id)}`);
  return Number(match[1]);
}

describe("per-section card width", () => {
  it("narrows relics, acquisition and mastery to the item-grid floor", () => {
    const { minWidth, gap } = itemGridFloor();
    for (const id of NARROW_SECTIONS) expect(cardMinWidthFor(id)).toBe(minWidth);
    expect(CARD_GAP).toBe(gap);
  });

  it("leaves tasks at the full card width", () => {
    expect(cardMinWidthFor("tasks")).toBe(CARD_MIN_WIDTH);
    expect(cardMinWidthFor("tasks")).toBeGreaterThan(cardMinWidthFor("relics"));
  });

  it("gives every section a width", () => {
    for (const id of SUGGESTION_SECTION_IDS) expect(cardMinWidthFor(id)).toBeGreaterThan(0);
  });
});

describe("pageSizeFor mirrors the grid template", () => {
  // A page that counted a different floor than the CSS laid out would skip or
  // repeat cards, so every section is walked across the widths a real window hits.
  it("counts exactly the tracks auto-fill lays out, at every width", () => {
    for (const id of SUGGESTION_SECTION_IDS) {
      const floor = templateFloor(id);
      expect(floor).toBe(cardMinWidthFor(id));
      for (let width = 1; width <= 2400; width += 1) {
        const tracks = Math.max(1, Math.floor((width + CARD_GAP) / (floor + CARD_GAP)));
        expect(pageSizeFor(width, id), `${id} at ${width}px`).toBe(tracks);
      }
    }
  });

  it("adds a track exactly where the narrower floor earns one", () => {
    // Four tasks tracks need 4x248 + 3x12 = 1028px; four narrow ones need 836px.
    expect(pageSizeFor(1027, "tasks")).toBe(3);
    expect(pageSizeFor(1028, "tasks")).toBe(4);
    expect(pageSizeFor(835, "relics")).toBe(3);
    expect(pageSizeFor(836, "relics")).toBe(4);
  });

  it("fits more narrow cards on a page than wide ones at the same width", () => {
    expect(pageSizeFor(1400, "acquisition")).toBeGreaterThan(pageSizeFor(1400, "tasks"));
  });

  it("falls back to one column on a width it has not measured yet", () => {
    for (const id of SUGGESTION_SECTION_IDS) {
      expect(pageSizeFor(0, id)).toBe(1);
      expect(pageSizeFor(Number.NaN, id)).toBe(1);
      expect(pageSizeFor(-40, id)).toBe(1);
    }
  });
});

describe("paging an uncapped section", () => {
  it("gives a long section real pages, so both arrows come alive", () => {
    const pageSize = pageSizeFor(1600, "acquisition");
    const pageCount = pageCountFor(40, pageSize);
    expect(pageSize).toBeGreaterThan(1);
    expect(pageCount).toBeGreaterThan(1);
    // The pager disables prev at 0 and next at the last page; a middle page has both.
    expect(clampPage(1, pageCount)).toBe(1);
    expect(clampPage(pageCount, pageCount)).toBe(pageCount - 1);
  });

  it("keeps one page for a section that fits, and clamps into it", () => {
    const pageSize = pageSizeFor(1600, "tasks");
    expect(pageCountFor(pageSize, pageSize)).toBe(1);
    expect(pageCountFor(0, pageSize)).toBe(1);
    expect(clampPage(5, 1)).toBe(0);
    expect(clampPage(-2, 3)).toBe(0);
  });

  it("shows every card across the pages it counted, once each", () => {
    for (const id of SUGGESTION_SECTION_IDS) {
      const total = 37;
      const pageSize = pageSizeFor(1280, id);
      const pageCount = pageCountFor(total, pageSize);
      const cards = Array.from({ length: total }, (_, index) => index);
      const seen: number[] = [];
      for (let page = 0; page < pageCount; page += 1) {
        seen.push(...cards.slice(page * pageSize, page * pageSize + pageSize));
      }
      expect(seen, id).toEqual(cards);
    }
  });
});
