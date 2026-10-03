import { buildSellPlan } from "./sellPlan.js";
import type { RecipeClaim } from "./recipeClaims.js";
import type { ItemDbEntry, MasteryData, MasteryStatus } from "../types/inventory.js";

interface RowLike {
  name: string;
  internalName?: string;
  amount?: number | null;
  parentMastered?: boolean;
  spare?: boolean;
}

interface PartMasteryFlags {
  parentMastered?: boolean;
  spare?: boolean;
  /** Copies free to sell once every unfinished recipe is served. */
  sellable?: number;
  reserved?: number;
  claims?: RecipeClaim[];
}

type PartMasteryResolver = (row: RowLike) => PartMasteryFlags;

interface PartMasteryOptions {
  /** Keep a copy of gear another recipe consumes, so both variants survive. */
  keepVariants?: boolean;
}

/** Per-row mastery and sell-safety flags, read off the shared sell plan. Gear
 * and rows that are not parts carry only the mastered flag, and filters skip
 * a row with no flags at all. */
export function buildPartMasteryResolver(
  itemDb: Record<string, ItemDbEntry>,
  mastery: MasteryData | null,
  inventoryData?: unknown,
  options: PartMasteryOptions = {},
): PartMasteryResolver {
  const plan = buildSellPlan(itemDb, mastery, inventoryData, options);
  if (!plan) return () => ({});

  const masteredFlag = (status: MasteryStatus | undefined): PartMasteryFlags =>
    status ? { parentMastered: status === "mastered" } : {};

  return (row) => {
    const setBase = /\sSet$/i.test(row.name) ? row.name.replace(/\s+Set$/i, "") : null;
    if (setBase) return masteredFlag(plan.statusOf(undefined, setBase));

    const key = plan.resolveKey(row.internalName, row.name);
    if (!key || plan.isGear(key))
      return masteredFlag(plan.statusOf(key ?? row.internalName, row.name));

    const owned = typeof row.amount === "number" ? row.amount : 0;
    const verdict = plan.verdict(key, owned);
    if (!verdict) return masteredFlag(plan.statusOf(key, row.name));

    const parent = plan.parentOf(key);
    const status = parent ? plan.statusOf(parent, itemDb[parent]?.name) : undefined;
    return {
      ...masteredFlag(status),
      reserved: verdict.reserved,
      claims: verdict.claims,
      ...(typeof row.amount === "number"
        ? { spare: verdict.sellable > 0, sellable: verdict.sellable }
        : {}),
    };
  };
}

/** Takes a prebuilt resolver: it indexes the whole item database, so callers
 * keep one per itemDb/mastery pair instead of rebuilding it per row list. */
export function attachPartMasteryFlags<T extends RowLike>(
  rows: T[],
  resolve: PartMasteryResolver,
): T[] {
  return rows.map((row) => {
    const flags = resolve(row);
    return Object.keys(flags).length === 0 ? row : { ...row, ...flags };
  });
}
