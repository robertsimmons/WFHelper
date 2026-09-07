/** The card box, in px. A card fills its grid track, so the width is only the
 *  floor a track may shrink to. */
export const CARD_MIN_WIDTH = 248;
export const CARD_HEIGHT = 192;
export const CARD_GAP = 12;

/** One row keeps all four sections and their pagers inside a 1000px window. A
 *  deeper page would also have to reserve the rows a short section cannot fill. */
const GRID_ROWS = 1;

/** Mirrors `repeat(auto-fill, minmax(CARD_MIN_WIDTH, 1fr))`, so a page holds
 *  exactly the tracks the browser laid out. */
function gridColumns(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
}

export function pageSizeFor(width: number): number {
  return gridColumns(width) * GRID_ROWS;
}

export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(0, page), Math.max(1, pageCount) - 1);
}
