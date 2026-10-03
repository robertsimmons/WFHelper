import { planGroup } from "./materials.js";
import type {
  AuthoredPlan,
  PlanBadge,
  PlanGroup,
  PlanGroupType,
  PlanMaterial,
  PlanPrice,
  PlanRow,
} from "./schema.js";

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
  cost?:
    | {
        credits: number | null;
        plat: { set: number | null; partsTotal: number | null } | null;
      }
    | undefined;
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

/** A multi-step path has no single node to head its group with, and a Market
 *  line's own text restates the price the head already carries. */
const PATH_PLACES: Record<string, string> = {
  nemesis: "NEMESIS HUNT",
  market: "MARKET",
};

/** Buying off another player and the Circuit are shortcuts, not the farm: they
 *  read as a price and a badge unless nothing else yields the part. */
const SHORTCUT_KINDS = new Set(["trade", "circuit"]);

function row(label: string, qty: number | null): PlanRow {
  return {
    qty: qty === null ? null : qty.toLocaleString("en-US"),
    label,
    note: null,
    alt: null,
    done: false,
  };
}

/** A Market blueprint is bought outright, so it claims the main blueprint first;
 *  each other part goes to the easiest path that farms it, paths arriving easiest
 *  first. A path covering nothing (an Incarnon adapter) is itself the thing wanted. */
function passOf(kind: string): number {
  if (kind === "market") return 0;
  return SHORTCUT_KINDS.has(kind) ? 2 : 1;
}

function assignParts(paths: readonly SourcePath[]): Map<SourcePath, string[]> {
  const taken = new Set<string>();
  const chosen = new Map<SourcePath, string[]>();
  for (const pass of [0, 1, 2]) {
    for (const path of paths) {
      if (passOf(path.kind) !== pass) continue;
      const parts = path.covers.filter((part) => !taken.has(part));
      if (path.covers.length > 0 && parts.length === 0) continue;
      for (const part of parts) taken.add(part);
      chosen.set(path, parts);
    }
  }
  return chosen;
}

function stepRows(path: SourcePath, parts: readonly string[], name: string): PlanRow[] {
  const adapter = path.kind === "circuit" && path.covers.length === 0;
  const labels = parts.length > 0 ? [...parts] : [adapter ? `${name} Incarnon Genesis` : name];
  if (path.steps.length <= 1) return labels.map((label) => row(label, null));
  return [...path.steps.map((step) => row(step.where, null)), ...labels.map((l) => row(l, null))];
}

function pathPlace(path: SourcePath, name: string): string {
  const fixed = PATH_PLACES[path.kind];
  if (fixed) return fixed;
  if (path.steps.length === 1) return path.steps[0].where.toUpperCase();
  return name.toUpperCase();
}

function pathWhere(path: SourcePath): string {
  return path.steps.map((step) => step.where).join("; ");
}

/** One group per trip, gates first. Two paths to the same place share a group,
 *  and a farm route that lost a part to an easier one sits behind a disclosure. */
function pathGroups(source: FallbackSource): PlanGroup[] {
  const chosen = assignParts(source.paths);
  const byKey = new Map<string, PlanGroup>();
  const ownerOf = new Map<string, PlanGroup>();
  for (const [path, parts] of chosen) {
    const type = PATH_GROUPS[path.kind] ?? "farm";
    const place = pathPlace(path, source.name);
    const key = `${type}|${place}`;
    const rows = stepRows(path, parts, source.name);
    const existing = byKey.get(key);
    const target = existing ?? planGroup(type, place, []);
    for (const next of rows) {
      if (!target.rows.some((have) => have.label === next.label)) target.rows.push(next);
    }
    if (!existing) byKey.set(key, target);
    for (const part of parts) ownerOf.set(part, target);
  }

  for (const path of source.paths) {
    if (chosen.has(path) || SHORTCUT_KINDS.has(path.kind)) continue;
    const owner = path.covers.map((part) => ownerOf.get(part)).find((found) => found);
    owner?.disclosures.push({ title: "also from", body: pathWhere(path) });
  }

  const groups = [...byKey.values()];
  return [
    ...groups.filter((entry) => entry.type === "gate"),
    ...groups.filter((entry) => entry.type !== "gate"),
  ];
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function pathPrices(source: FallbackSource): PlanPrice[] {
  const prices: PlanPrice[] = [];
  for (const path of source.paths) {
    const cost = path.cost;
    if (!cost) continue;
    if (path.kind === "market" && cost.credits !== null && cost.credits > 0) {
      prices.push({ label: "blueprint", amount: `${formatNumber(cost.credits)} cr`, money: false });
    }
    if (path.kind === "trade" && cost.plat) {
      if (cost.plat.set !== null) {
        prices.push({ label: "built", amount: `${formatNumber(cost.plat.set)} p`, money: false });
      } else if (cost.plat.partsTotal !== null) {
        prices.push({
          label: "parts",
          amount: `${formatNumber(cost.plat.partsTotal)} p`,
          money: false,
        });
      }
    }
  }
  return prices;
}

function pathBadges(source: FallbackSource): PlanBadge[] {
  const chosen = assignParts(source.paths);
  const circuitAlt = source.paths.some(
    (path) => path.kind === "circuit" && path.covers.length > 0 && !chosen.has(path),
  );
  return circuitAlt ? [{ text: "Circuit alt", tone: "circuit" }] : [];
}

function sourceMaterials(source: FallbackSource): PlanMaterial[] {
  return source.parts.materials
    .filter((material) => material.missing > 0)
    .map((material) => ({
      qty: material.required.toLocaleString("en-US"),
      label: material.name,
      note: null,
    }));
}

function foundryGroups(source: FallbackSource): PlanGroup[] {
  const out: PlanGroup[] = [];
  const components = source.parts.components.filter((part) => part.missing > 0);
  if (components.length > 0) {
    out.push(
      planGroup(
        "foundry",
        "FOUNDRY",
        components.map((part) => row(part.name, null)),
      ),
    );
  }
  const credits = source.parts.credits;
  out.push(
    planGroup("foundry", "FOUNDRY", [row(source.name, null)], {
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
  const groups = pathGroups(source);
  const materials = sourceMaterials(source);
  if (source.parts.known) groups.push(...foundryGroups(source));
  if (groups.length === 0)
    groups.push(planGroup("farm", source.name.toUpperCase(), [row(source.name, null)]));

  const parts = source.parts;
  const need = parts.components.length + (parts.main ? 1 : 0);
  const have = need - parts.missing.length;

  return {
    name: source.name,
    kind: source.kind,
    effort: effortOf(source),
    tradeable: null,
    progress: { have: Math.max(0, have), need: Math.max(need, 1), unit: "parts" },
    badges: [{ text: "no community notes yet", tone: "info" }, ...pathBadges(source)],
    prices: pathPrices(source),
    groups,
    materials,
  };
}
