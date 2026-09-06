import { describe, expect, it } from "vitest";

import {
  CARD_GAP,
  CARD_HEIGHT,
  CARD_WIDTH,
  clampPage,
  gridCapacity,
  MAX_GRID_ROWS,
  pageCountFor,
} from "../../../../src/lib/suggest/grid.js";

function span(count: number, size: number): number {
  return count * size + (count - 1) * CARD_GAP;
}

describe("gridCapacity", () => {
  it("counts the whole cards that fit across and down", () => {
    const capacity = gridCapacity(span(4, CARD_WIDTH), span(2, CARD_HEIGHT));
    expect(capacity).toEqual({ columns: 4, rows: 2, pageSize: 8 });
  });

  it("ignores a partial column or row", () => {
    const capacity = gridCapacity(
      span(3, CARD_WIDTH) + CARD_GAP + CARD_WIDTH - 1,
      span(2, CARD_HEIGHT) + CARD_GAP + CARD_HEIGHT - 1,
    );
    expect(capacity).toEqual({ columns: 3, rows: 2, pageSize: 6 });
  });

  it("caps the rows however tall the region is", () => {
    const tall = gridCapacity(span(4, CARD_WIDTH), span(MAX_GRID_ROWS + 3, CARD_HEIGHT));
    expect(tall).toEqual({ columns: 4, rows: MAX_GRID_ROWS, pageSize: 4 * MAX_GRID_ROWS });
  });

  it("clamps to one card each way when the region is smaller than a card", () => {
    expect(gridCapacity(10, 10)).toEqual({ columns: 1, rows: 1, pageSize: 1 });
  });

  it("clamps to one card each way before the region has been measured", () => {
    expect(gridCapacity(0, 0)).toEqual({ columns: 1, rows: 1, pageSize: 1 });
    expect(gridCapacity(Number.NaN, Number.NaN)).toEqual({ columns: 1, rows: 1, pageSize: 1 });
  });
});

describe("pageCountFor", () => {
  it("counts a short last page as a page", () => {
    expect(pageCountFor(9, 4)).toBe(3);
  });

  it("is one page when there is nothing to show", () => {
    expect(pageCountFor(0, 8)).toBe(1);
  });
});

describe("clampPage", () => {
  it("keeps a page that is still in range", () => {
    expect(clampPage(2, 4)).toBe(2);
  });

  it("pulls a stranded page back to the last one when a resize drops the page count", () => {
    const narrow = gridCapacity(span(2, CARD_WIDTH), span(1, CARD_HEIGHT)).pageSize;
    const wide = gridCapacity(span(4, CARD_WIDTH), span(2, CARD_HEIGHT)).pageSize;
    expect([narrow, wide]).toEqual([2, 8]);
    expect(clampPage(9, pageCountFor(20, narrow))).toBe(9);
    expect(clampPage(9, pageCountFor(20, wide))).toBe(2);
  });

  it("never goes below the first page", () => {
    expect(clampPage(-3, 1)).toBe(0);
    expect(clampPage(5, 0)).toBe(0);
  });
});
