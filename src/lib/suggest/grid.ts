import type { SuggestionSectionId } from "../../types/suggest.js";

export const CARD_HEIGHT = 192;
export const CARD_GAP = 12;

/** The card box, in px. A card fills its grid track, so the width is only the
 *  floor a track may shrink to. */
export const CARD_MIN_WIDTH = 248;

/** Relics, acquisition and mastery draw item art rather than a banner, so their
 *  tracks take the `.item-grid` floor the Mastery and Inventory views use. */
const NARROW_CARD_MIN_WIDTH = 200;

const SECTION_CARD_MIN_WIDTH: Record<SuggestionSectionId, number> = {
  tasks: CARD_MIN_WIDTH,
  relics: NARROW_CARD_MIN_WIDTH,
  acquisition: NARROW_CARD_MIN_WIDTH,
  mastery: NARROW_CARD_MIN_WIDTH,
};

export function cardMinWidthFor(id: SuggestionSectionId): number {
  return SECTION_CARD_MIN_WIDTH[id] ?? CARD_MIN_WIDTH;
}

/** The only place the grid template is written. A page that counted a different
 *  track floor than the browser laid out would skip or repeat cards. */
export function gridTemplateFor(id: SuggestionSectionId): string {
  return `repeat(auto-fill, minmax(${cardMinWidthFor(id)}px, 1fr))`;
}

/** Never a third row: a page the reader has to scroll to finish is not a page. */
const MAX_GRID_ROWS = 2;

/** Mirrors `gridTemplateFor`, so a page holds exactly the tracks the browser
 *  laid out. */
function gridColumns(width: number, minWidth: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + CARD_GAP) / (minWidth + CARD_GAP)));
}

/** An unmeasured height reads as one row, which is what fits everywhere.
 *
 *  Rounded, not floored: a row is claimed once most of it is on screen. Flooring
 *  left the second row 13px short of its budget at 1600x1000, which spent half
 *  the window on nothing to save the reader a few pixels of scrolling. */
function gridRows(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return 1;
  const fit = Math.round((height + CARD_GAP) / (CARD_HEIGHT + CARD_GAP));
  return Math.min(MAX_GRID_ROWS, Math.max(1, fit));
}

/** The px a page's rows occupy, reserved so a short last page does not pull the
 *  sections below it up the column. */
export function gridMinHeightFor(height: number): number {
  const rows = gridRows(height);
  return rows * CARD_HEIGHT + (rows - 1) * CARD_GAP;
}

export function pageSizeFor(width: number, id: SuggestionSectionId, height = 0): number {
  return gridColumns(width, cardMinWidthFor(id)) * gridRows(height);
}

export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(0, page), Math.max(1, pageCount) - 1);
}
