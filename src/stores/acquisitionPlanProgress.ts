import { writable, type Readable } from "svelte/store";

import { readStoredJson, writeStorage } from "../lib/persistence.js";

const KEY = "acquisition.planProgress";

/** What the player answered on a plan that inventory cannot answer for them,
 *  by row id. */
export interface PlanProgressEntry {
  manualDone: string[];
  manualCleared: string[];
  altsTaken: string[];
}

export type PlanProgressTable = Record<string, PlanProgressEntry>;

const EMPTY: PlanProgressEntry = { manualDone: [], manualCleared: [], altsTaken: [] };

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((row): row is string => typeof row === "string"))];
}

function normalize(parsed: unknown): PlanProgressTable {
  if (!parsed || typeof parsed !== "object") return {};
  const table: PlanProgressTable = {};
  for (const [item, entry] of Object.entries(parsed as Record<string, unknown>)) {
    const record = (entry ?? {}) as Record<string, unknown>;
    table[item] = {
      manualDone: ids(record.manualDone),
      manualCleared: ids(record.manualCleared),
      altsTaken: ids(record.altsTaken),
    };
  }
  return table;
}

const store = writable<PlanProgressTable>(readStoredJson(KEY, normalize, () => ({})));

/** Manual ticks and taken alternatives, per pinned item. */
export const planProgress: Readable<PlanProgressTable> = { subscribe: store.subscribe };

export function planProgressFor(table: PlanProgressTable, item: string): PlanProgressEntry {
  return table[item] ?? EMPTY;
}

function toggle(list: readonly string[], rowId: string): string[] {
  return list.includes(rowId) ? list.filter((id) => id !== rowId) : [...list, rowId];
}

function excluding(list: readonly string[], rowId: string): string[] {
  return list.filter((id) => id !== rowId);
}

function including(list: readonly string[], rowId: string): string[] {
  return list.includes(rowId) ? [...list] : [...list, rowId];
}

function write(item: string, change: (entry: PlanProgressEntry) => PlanProgressEntry): void {
  store.update((table) => {
    const next = { ...table, [item]: change(table[item] ?? EMPTY) };
    writeStorage(KEY, JSON.stringify(next));
    return next;
  });
}

/** Both lists are kept because an authored row starts done, so clearing one has
 *  to be recorded rather than read as the absence of a tick. */
export function setPlanRowDone(item: string, rowId: string, done: boolean): void {
  write(item, (entry) => ({
    ...entry,
    manualDone: done ? including(entry.manualDone, rowId) : excluding(entry.manualDone, rowId),
    manualCleared: done
      ? excluding(entry.manualCleared, rowId)
      : including(entry.manualCleared, rowId),
  }));
}

export function togglePlanAltTaken(item: string, rowId: string): void {
  write(item, (entry) => ({ ...entry, altsTaken: toggle(entry.altsTaken, rowId) }));
}
