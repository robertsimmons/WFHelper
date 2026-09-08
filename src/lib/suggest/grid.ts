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

/** One row keeps all four sections and their pagers inside a 1000px window. A
 *  deeper page would also have to reserve the rows a short section cannot fill. */
const GRID_ROWS = 1;

/** Mirrors `gridTemplateFor`, so a page holds exactly the tracks the browser
 *  laid out. */
function gridColumns(width: number, minWidth: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + CARD_GAP) / (minWidth + CARD_GAP)));
}

export function pageSizeFor(width: number, id: SuggestionSectionId): number {
  return gridColumns(width, cardMinWidthFor(id)) * GRID_ROWS;
}

export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(0, page), Math.max(1, pageCount) - 1);
}
