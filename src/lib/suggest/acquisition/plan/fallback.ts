import { resourceEntry } from "./resources.js";
import type { AuthoredPlan, PlanGroup, PlanGroupType, PlanRow } from "./schema.js";

interface CountedItem {
  name: string;
  required: number;
  owned: number;
  missing: number;
}

interface SourceStep {
  kind: string;
  where: string;
  parts: readonly string[];
}

interface SourcePath {
  kind: string;
  covers: readonly string[];
  steps: readonly SourceStep[];
}

/** What a fallback plan needs off an acquisition target, named here so this layer
 *  never depends on the target's own evolving shape. */
export interface FallbackSource {
  name: string;
  kind: string;
  /** The letter the card draws: the player's override, else the ranking table. */
  tier: string | null;
  effort?: number | undefined;
  parts: {
    known: boolean;
    main: CountedItem | null;
    components: readonly CountedItem[];
    missing: readonly CountedItem[];
    materials: readonly CountedItem[];
    credits: number;
  };
  paths: readonly SourcePath[];
}

const PATH_GROUPS: Record<string, PlanGroupType> = {
  market: "vendor",
  trade: "vendor",
  vendor: "vendor",
  lab: "research",
  junction: "gate",
  quest: "gate",
  boss: "boss",
  mission: "farm",
  bounty: "bounty",
  relics: "relics",
  circuit: "farm",
  nemesis: "boss",
};

function group(
  type: PlanGroupType,
  place: string,
  rows: PlanRow[],
  extra: Partial<PlanGroup> = {},
): PlanGroup {
  return {
    type,
    place,
    sub: null,
    activity: null,
    meta: null,
    mode: null,
    live: null,
    skip: null,
    earns: null,
    spends: [],
    map: null,
    rows,
    conditions: [],
    bonuses: [],
    disclosures: [],
    ...extra,
  };
}

function row(label: string, qty: number | null): PlanRow {
  return {
    qty: qty === null ? null : qty.toLocaleString("en-US"),
    label,
    note: null,
    alt: null,
    done: false,
  };
}

function pathGroups(source: FallbackSource): PlanGroup[] {
  const path = source.paths[0];
  if (!path) return [];
  const out: PlanGroup[] = [];
  for (const step of path.steps) {
    const labels = step.parts.length > 0 ? [...step.parts] : [source.name];
    out.push(
      group(
        PATH_GROUPS[step.kind] ?? "farm",
        step.where.toUpperCase(),
        labels.map((label) => row(label, null)),
      ),
    );
  }
  return out;
}

/** Materials group under the mission the shared resource table names, so the
 *  same resource reads the same way in every plan that needs it. */
function materialGroups(source: FallbackSource): PlanGroup[] {
  const byPlace = new Map<string, { group: PlanGroup; order: number }>();
  let order = 0;
  for (const material of source.parts.materials) {
    if (material.missing <= 0) continue;
    const entry = resourceEntry(material.name);
    const best = entry?.best ?? null;
    const place = best ? best.place : "MATERIALS";
    const key = `${place}|${best?.sub ?? ""}|${best?.activity ?? ""}`;
    let bucket = byPlace.get(key);
    if (!bucket) {
      bucket = {
        order: order++,
        group: group("farm", place, [], {
          sub: best?.sub ?? null,
          activity: best?.activity ?? null,
          meta: best?.meta ?? null,
          map: entry?.harvestable ? (entry.map ?? null) : null,
        }),
      };
      byPlace.set(key, bucket);
    }
    bucket.group.rows.push(row(material.name, material.required));
  }
  return [...byPlace.values()].sort((a, b) => a.order - b.order).map((bucket) => bucket.group);
}

function foundryGroups(source: FallbackSource): PlanGroup[] {
  const out: PlanGroup[] = [];
  const components = source.parts.components.filter((part) => part.missing > 0);
  if (components.length > 0) {
    out.push(
      group(
        "foundry",
        "FOUNDRY",
        components.map((part) => row(part.name, null)),
      ),
    );
  }
  const credits = source.parts.credits;
  out.push(
    group("foundry", "FOUNDRY", [row(source.name, null)], {
      meta: credits > 0 ? `${credits.toLocaleString("en-US")} cr` : null,
    }),
  );
  return out;
}

function effortOf(source: FallbackSource): number {
  const raw = source.effort;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 5;
  const scaled = raw <= 1 ? raw * 10 : raw;
  return Math.min(10, Math.max(1, Math.round(scaled)));
}

/** A plan from the drop table alone, for an item nobody has written notes for.
 *  Sparse on purpose: an unknown is never padded out to look researched. */
export function fallbackPlan(source: FallbackSource): AuthoredPlan {
  const groups = [...pathGroups(source), ...materialGroups(source)];
  if (source.parts.known) groups.push(...foundryGroups(source));
  if (groups.length === 0)
    groups.push(group("farm", source.name.toUpperCase(), [row(source.name, null)]));

  const parts = source.parts;
  const need = parts.components.length + (parts.main ? 1 : 0);
  const have = need - parts.missing.length;

  return {
    name: source.name,
    kind: source.kind,
    effort: effortOf(source),
    tradeable: null,
    progress: { have: Math.max(0, have), need: Math.max(need, 1), unit: "parts" },
    badges: [{ text: "no community notes yet", tone: "info" }],
    prices: [],
    groups,
  };
}
