import warframes from "../../../data/suggest/warframes.json";

export interface CuratedSource {
  kind: string;
  /** Which half of the build this source pays out. */
  parts: "main" | "components" | "both";
  where: string;
}

export interface CuratedEntry {
  difficulty: string | null;
  circuit: boolean;
  sources: CuratedSource[];
}

const EMPTY: CuratedEntry = { difficulty: null, circuit: false, sources: [] };

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

function readEntry(value: unknown): CuratedEntry {
  if (!value || typeof value !== "object") return EMPTY;
  const raw = value as Record<string, unknown>;
  return {
    difficulty: typeof raw.difficulty === "string" ? raw.difficulty : null,
    circuit: raw.circuit === true,
    sources: readSources(raw.sources),
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
