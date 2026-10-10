import type { PlanBadge, PlanRank } from "./schema.js";

/** A gate a generated Prime plan cannot derive, such as the quest Railjack relics need. */
export interface PrimeGate {
  label: string;
  note: string | null;
  rank?: PlanRank | null;
}

/** What live data cannot say about one relic Prime. Tips stay out of it. */
export interface PrimeOverride {
  name: string;
  badges?: PlanBadge[];
  gates?: PrimeGate[];
  effort?: { value: number; reason: string };
}

const loaded = import.meta.glob("../../../../data/suggest/primeOverrides/*.json", {
  eager: true,
});

const SHIPPED: PrimeOverride[] = Object.entries(loaded)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, module]) => ((module as { default?: unknown }).default ?? module) as PrimeOverride);

const BY_NAME = new Map(SHIPPED.map((entry) => [entry.name.trim().toLowerCase(), entry]));

export type PrimeOverrideLookup = (name: string) => PrimeOverride | null;

export function primeOverrides(): PrimeOverride[] {
  return [...SHIPPED];
}

export const primeOverride: PrimeOverrideLookup = (name) =>
  BY_NAME.get(name.trim().toLowerCase()) ?? null;
