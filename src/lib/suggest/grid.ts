/** The card box, in px. The card applies these so the pager and the grid agree
 *  on how much a page holds. */
export const CARD_WIDTH = 288;
export const CARD_HEIGHT = 192;
export const CARD_GAP = 12;

/** The grid never pages more than this many rows, however tall the region is. */
export const MAX_GRID_ROWS = 2;

interface GridCapacity {
  columns: number;
  rows: number;
  pageSize: number;
}

function fits(available: number, size: number, gap: number): number {
  if (!Number.isFinite(available) || available <= 0) return 1;
  return Math.max(1, Math.floor((available + gap) / (size + gap)));
}

/** How many whole cards a page holds, never fewer than one and never more than
 *  MAX_GRID_ROWS deep. */
export function gridCapacity(width: number, height: number): GridCapacity {
  const columns = fits(width, CARD_WIDTH, CARD_GAP);
  const rows = Math.min(fits(height, CARD_HEIGHT, CARD_GAP), MAX_GRID_ROWS);
  return { columns, rows, pageSize: columns * rows };
}

export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(0, page), Math.max(1, pageCount) - 1);
}
