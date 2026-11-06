import { rankSyndicate } from "./ranks.js";
import type { PlanCurrency, PlanGroup, PlanRank, PlanRow } from "./schema.js";
import type { ResolvedRow } from "./types.js";

const STANDING = /standing$/i;

/** How standing purchases tie a plan's rank-ups and standing groups together. */
export interface StandingLinks {
  /** A rank-up row's id to the purchases it is ranked for. */
  unlocks: Map<string, string[]>;
  /** A currency group's index to the rows its own currency buys. */
  buys: Map<number, string[]>;
  /** A purchase naming no rank to the top rank-up the plan climbs for it. */
  ranks: Map<string, PlanRank>;
  /** An item a rank-up sacrifices, listed outside a vendor, to the vendor rank-up
   *  row that takes it: the lowest one at or above its rank. */
  paidAt: Map<string, string>;
}

interface RowAt {
  row: PlanRow;
  id: string;
  groupIndex: number;
}

interface RankUp extends RowAt {
  rank: PlanRank;
  syndicate: string;
}

interface Purchase extends RowAt {
  price: PlanCurrency[];
  rank: PlanRank | null;
}

const syndicateKey = (name: string): string =>
  rankSyndicate(name)?.tag ?? name.trim().toLowerCase();

const higher = (best: PlanRank | null, rank: PlanRank): PlanRank =>
  best && best.level >= rank.level ? best : rank;

/** Each item a rank-up sacrifices to the vendor rank-up row it is paid at. */
function sacrificesPaidAt(
  groups: readonly PlanGroup[],
  rankUps: readonly RankUp[],
  namesItem: (label: string) => boolean,
): Map<string, string> {
  const atVendor = (entry: RankUp): boolean => groups[entry.groupIndex].type === "vendor";
  const paid = rankUps.filter(atVendor);
  const out = new Map<string, string>();
  for (const sacrifice of rankUps.filter((entry) => !atVendor(entry))) {
    if (!namesItem(sacrifice.row.label)) continue;
    const at = paid
      .filter((entry) => entry.syndicate === sacrifice.syndicate)
      .filter((entry) => entry.rank.level >= sacrifice.rank.level)
      .reduce<RankUp | null>(
        (low, entry) => (low && low.rank.level <= entry.rank.level ? low : entry),
        null,
      );
    if (at) out.set(sacrifice.id, at.id);
  }
  return out;
}

export function standingLinks(
  groups: readonly PlanGroup[],
  rowId: (groupIndex: number, rowIndex: number) => string,
  ledgerName: (currency: string) => string,
  namesItem: (label: string) => boolean,
): StandingLinks {
  const rows: RowAt[] = groups.flatMap((group, groupIndex) =>
    group.rows.map((row, rowIndex) => ({ row, id: rowId(groupIndex, rowIndex), groupIndex })),
  );
  const standings = (price: readonly PlanCurrency[]): string[] =>
    price.map((spend) => ledgerName(spend.currency)).filter((name) => STANDING.test(name));

  const rankUps: RankUp[] = rows.flatMap((entry) =>
    entry.row.rank
      ? [{ ...entry, rank: entry.row.rank, syndicate: syndicateKey(entry.row.rank.syndicate) }]
      : [],
  );
  const purchases: Purchase[] = rows.flatMap((entry) => {
    const { buy, rank, task, pick } = entry.row;
    return buy && !rank && !task && !pick
      ? [{ ...entry, price: buy.price, rank: buy.rank ?? null }]
      : [];
  });

  const paidIn = new Map<string, Set<string>>();
  for (const entry of rankUps) {
    const paid = paidIn.get(entry.syndicate) ?? new Set<string>();
    for (const name of standings(entry.row.buy?.price ?? [])) paid.add(name);
    paidIn.set(entry.syndicate, paid);
  }
  const syndicatesOf = (purchase: Purchase): string[] => {
    if (purchase.rank) return [syndicateKey(purchase.rank.syndicate)];
    const own = standings(purchase.price);
    return [...paidIn].filter(([, paid]) => own.some((name) => paid.has(name))).map(([key]) => key);
  };

  const bySyndicate = new Map<string, string[]>();
  const ranks = new Map<string, PlanRank>();
  for (const purchase of purchases.filter((entry) => standings(entry.price).length > 0)) {
    const syndicates = syndicatesOf(purchase);
    for (const key of syndicates)
      bySyndicate.set(key, [...(bySyndicate.get(key) ?? []), purchase.id]);
    if (purchase.rank || syndicates.length !== 1) continue;
    const top = rankUps
      .filter((entry) => entry.syndicate === syndicates[0])
      .reduce<PlanRank | null>((best, entry) => higher(best, entry.rank), null);
    if (top) ranks.set(purchase.id, top);
  }

  const unlocks = new Map<string, string[]>();
  for (const entry of rankUps) {
    const ids = bySyndicate.get(entry.syndicate);
    if (ids) unlocks.set(entry.id, ids);
  }

  const buys = new Map<number, string[]>();
  groups.forEach((group, groupIndex) => {
    const currency = group.ref ?? group.earns?.currency;
    if (group.type !== "currency" || !currency) return;
    const own = ledgerName(currency);
    const ids = purchases
      .filter((entry) => entry.groupIndex === groupIndex && ledgerName(entry.row.label) !== own)
      .filter((entry) => entry.price.some((spend) => ledgerName(spend.currency) === own))
      .map((entry) => entry.id);
    if (ids.length > 0) buys.set(groupIndex, ids);
  });

  return { unlocks, buys, ranks, paidAt: sacrificesPaidAt(groups, rankUps, namesItem) };
}

interface SettleGroup<R extends ResolvedRow> {
  skip: unknown;
  rows: readonly R[];
  buys?: readonly string[] | undefined;
}

/** A rank-up is no longer needed once everything it is ranked for is in hand:
 *  done, skipped, or a reusable blueprint already held. */
export function settleRanks<R extends ResolvedRow>(groups: readonly SettleGroup<R>[]): R[][] {
  const done = new Set(
    groups.flatMap((group) =>
      group.rows
        .filter((row) => row.done || row.purchase?.owned || group.skip !== null)
        .map((row) => row.id),
    ),
  );
  return groups.map((group) =>
    group.rows.map((row) =>
      !row.done && row.unlocks?.every((id) => done.has(id)) ? { ...row, done: true } : row,
    ),
  );
}

/** Skipped, or every row done; a standing group needs only what its standing buys. */
export function groupDone<R extends ResolvedRow>(group: SettleGroup<R>): boolean {
  if (group.skip !== null) return true;
  const { buys } = group;
  const rows = buys ? group.rows.filter((row) => buys.includes(row.id)) : group.rows;
  return rows.every((row) => row.done);
}

/** Rows done of rows counted: a skipped group is left out, a done one counts whole. */
export function stepCount<R extends ResolvedRow>(
  groups: readonly (SettleGroup<R> & { done: boolean })[],
): { done: number; total: number } {
  let total = 0;
  let done = 0;
  for (const group of groups) {
    if (group.skip !== null) continue;
    total += group.rows.length;
    done += group.done ? group.rows.length : group.rows.filter((row) => row.done).length;
  }
  return { done, total };
}
