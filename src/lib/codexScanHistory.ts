import type { CodexScanLogRow } from "../../config/shared/codexScanLog.js";

interface ScanEntity {
  name: string;
  image: string | null;
  locations: string[];
}

export interface ScanDetailRow {
  type: string;
  name: string;
  image: string | null;
  after: number;
  required: number | null;
  delta: number;
  completedNow: boolean;
  locations: string[];
}

interface ScanSummary {
  completed: number;
  newScans: number;
  enemies: number;
}

export function scanSummary(rows: CodexScanLogRow[]): ScanSummary {
  let completed = 0;
  let newScans = 0;
  for (const row of rows) {
    if (row.completedNow) completed += 1;
    newScans += Math.max(0, row.after - row.before);
  }
  return { completed, newScans, enemies: rows.length };
}

function fallbackName(type: string): string {
  return type.split("/").filter(Boolean).pop() ?? type;
}

/** Planets first, then tilesets; missions only stand in when neither is known. */
export function scanLocations(planets: string[], tileSets: string[], missions: string[]): string[] {
  const places = [...new Set([...planets, ...tileSets])];
  return places.length > 0 ? places : [...new Set(missions)];
}

/** Finished first, then the biggest jump, then name for a stable order. */
export function buildScanDetailRows(
  rows: CodexScanLogRow[],
  lookup: (type: string) => ScanEntity | null,
): ScanDetailRow[] {
  return rows
    .map((row) => {
      const entity = lookup(row.type);
      return {
        type: row.type,
        name: row.name ?? entity?.name ?? fallbackName(row.type),
        image: entity?.image ?? null,
        after: row.after,
        required: row.required,
        delta: Math.max(0, row.after - row.before),
        completedNow: row.completedNow,
        locations: entity?.locations ?? [],
      };
    })
    .sort(
      (a, b) =>
        Number(b.completedNow) - Number(a.completedNow) ||
        b.delta - a.delta ||
        a.name.localeCompare(b.name),
    );
}
