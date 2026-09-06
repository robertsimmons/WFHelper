import warframes from "../../../data/suggest/warframes.json";
import type { NemesisBonusRange, NemesisFamily } from "./types.js";

export interface CuratedSource {
  kind: string;
  /** Which half of the build this source pays out. */
  parts: "main" | "components" | "both";
  where: string;
}

/** Everything about a nemesis weapon the app cannot derive from the item DB. */
export interface CuratedNemesis {
  family: NemesisFamily | null;
  requires: string[];
  spawn: string | null;
  elements: string[];
  bonus: NemesisBonusRange | null;
}

export interface CuratedEntry {
  difficulty: string | null;
  circuit: boolean;
  sources: CuratedSource[];
  nemesis: CuratedNemesis | null;
}

export type CuratedLookup = (name: string) => CuratedEntry;

const EMPTY: CuratedEntry = { difficulty: null, circuit: false, sources: [], nemesis: null };

/** The tables spell "Ack & Brunt" where the game exports "Ack And Brunt". */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function readParts(value: unknown): CuratedSource["parts"] {
  return value === "main" || value === "components" ? value : "both";
}

function readSources(value: unknown): CuratedSource[] {
  if (!Array.isArray(value)) return [];
  const out: CuratedSource[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const raw = row as Record<string, unknown>;
    const kind = typeof raw.kind === "string" ? raw.kind : "";
    const where = typeof raw.where === "string" ? raw.where : "";
    if (kind && where) out.push({ kind, parts: readParts(raw.parts), where });
  }
  return out;
}

const FAMILIES: readonly string[] = ["kuva", "tenet", "coda"];

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is string => typeof row === "string" && row.trim() !== "");
}

function readBonus(value: unknown): NemesisBonusRange | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const min = raw.min;
  const max = raw.max;
  if (typeof min !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
  return { min, max };
}

function readNemesis(value: unknown): CuratedNemesis | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const family = typeof raw.family === "string" ? raw.family.toLowerCase() : "";
  return {
    family: FAMILIES.includes(family) ? (family as NemesisFamily) : null,
    requires: readStrings(raw.requires),
    spawn: typeof raw.spawn === "string" && raw.spawn.trim() ? raw.spawn : null,
    elements: readStrings(raw.elements),
    bonus: readBonus(raw.bonus),
  };
}

function readEntry(value: unknown): CuratedEntry {
  if (!value || typeof value !== "object") return EMPTY;
  const raw = value as Record<string, unknown>;
  return {
    difficulty: typeof raw.difficulty === "string" ? raw.difficulty : null,
    circuit: raw.circuit === true,
    sources: readSources(raw.sources),
    nemesis: readNemesis(raw.nemesis),
  };
}

function buildTable(table: unknown): Map<string, CuratedEntry> {
  const out = new Map<string, CuratedEntry>();
  if (!table || typeof table !== "object") return out;
  for (const [name, value] of Object.entries(table as Record<string, unknown>)) {
    out.set(nameKey(name), readEntry(value));
  }
  return out;
}

const CURATED = buildTable(warframes);

/** A frame the table has never been given is unknown, never bad. A Prime is not
 *  its base frame here: it comes out of relics, wherever the base frame drops. */
export function curated(name: string): CuratedEntry {
  return CURATED.get(nameKey(name)) ?? EMPTY;
}

/** Weapon sources arrive through the context rather than a shipped file, so an
 *  absent, malformed or partial table reads as unknown for every weapon. */
export function createCurated(source?: unknown): CuratedLookup {
  const table = buildTable(source);
  return (name) => table.get(nameKey(name)) ?? EMPTY;
}

function hasContent(entry: CuratedEntry): boolean {
  return (
    entry.difficulty !== null || entry.circuit || entry.sources.length > 0 || entry.nemesis !== null
  );
}

/** Frames and weapons never share a name, so one lookup can serve both tables. */
export function mergeCurated(primary: CuratedLookup, secondary: CuratedLookup): CuratedLookup {
  return (name) => {
    const first = primary(name);
    return hasContent(first) ? first : secondary(name);
  };
}
