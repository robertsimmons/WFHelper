import { groupFacts, planEras, standingOwners } from "./facts.js";
import { formatGap, resolveCycleLive } from "./live.js";
import { materialGroups } from "./materials.js";
import { resourceEntry, type ResourceLookup } from "./resources.js";
import { altSpends, altText, type AuthoredPlan, type PlanGroup, type PlanRow } from "./schema.js";
import {
  formatQuantity,
  ownedForLabel,
  parseQuantity,
  pendingBuildFor,
  questDoneForLabel,
  readPlayerState,
  type PlayerState,
} from "./state.js";
import type {
  PlanContext,
  PlanFactKind,
  ResolvedFlow,
  ResolvedGroup,
  ResolvedLedgerEntry,
  ResolvedLive,
  ResolvedPlan,
  ResolvedRow,
  ResolvedSpend,
} from "./types.js";

/** No map has shipped yet, so every map link renders disabled. */
const MAPS_READY = new Set<string>();

const LEADING_AMOUNT = /^([\d,]+)\b/;
const CREDITS = "Credits";

interface PlanEntry {
  group: PlanGroup;
  id: string;
  rowId: (rowIndex: number) => string;
}

function withRefTips(group: PlanGroup, lookup: ResourceLookup): PlanGroup {
  const tips = group.ref ? (lookup(group.ref)?.tips ?? []) : [];
  if (tips.length === 0) return group;
  return { ...group, bonuses: [...new Set([...group.bonuses, ...tips])] };
}

/** Stored ticks are keyed by row id, so an authored row keeps the position it
 *  has in the file, and a material row, which moves whenever the store does, is
 *  keyed by its label. */
function planEntries(plan: AuthoredPlan, lookup: ResourceLookup): PlanEntry[] {
  const authored: PlanEntry[] = plan.groups.map((group, groupIndex) => ({
    group: withRefTips(group, lookup),
    id: String(groupIndex),
    rowId: (rowIndex) => `${groupIndex}:${rowIndex}`,
  }));
  const needs = (plan.materials ?? []).map((material) => ({
    label: material.label,
    qty: parseQuantity(material.qty),
    note: material.note,
  }));
  if (needs.length === 0) return authored;
  const materials: PlanEntry[] = materialGroups(needs, lookup).map((group, groupIndex) => ({
    group,
    id: `m${groupIndex}`,
    rowId: (rowIndex) => `m:${group.rows[rowIndex].label.trim().toLowerCase()}`,
  }));
  const build = authored.findIndex(
    (entry) => entry.group.type === "craft" || entry.group.type === "foundry",
  );
  const at = build === -1 ? authored.length : build;
  return [...authored.slice(0, at), ...materials, ...authored.slice(at)];
}

/** Per-row shares of a group's spend, but only when the row notes add up to the
 *  group total exactly. A decomposition that does not check out is not used, so
 *  the ledger never invents a split. */
function rowShares(group: PlanGroup, total: number): number[] | null {
  const shares: number[] = [];
  for (const row of group.rows) {
    const match = LEADING_AMOUNT.exec(row.note ?? "");
    if (!match) return null;
    shares.push(Number(match[1].replace(/,/g, "")));
  }
  const sum = shares.reduce((carry, value) => carry + value, 0);
  return sum === total ? shares : null;
}

interface RowResult {
  row: ResolvedRow;
  done: boolean;
}

function resolveRow(
  row: PlanRow,
  id: string,
  itemName: string,
  state: PlayerState,
  lookup: ResourceLookup,
  answers: { done: Set<string>; cleared: Set<string>; altsTaken: Set<string> },
): RowResult {
  const required = parseQuantity(row.qty);
  // A quest keychain is not an owned item, so the ownership map answers 0 for a
  // label the quest index can answer properly.
  const quest = questDoneForLabel(state, row.label);
  const owned =
    quest !== null
      ? null
      : lookup(row.label)?.name === CREDITS
        ? state.credits
        : ownedForLabel(state, row.label, itemName);
  const tracked = owned !== null;
  const remaining = Math.max(0, required - (owned ?? 0));

  // Nothing but the player can answer an untracked row, so their tick wins in
  // both directions and the authored flag is only where it starts.
  const ticked = answers.done.has(id);
  const cleared = answers.cleared.has(id);
  const manual = quest === null && !tracked;
  const done = quest ?? (tracked ? remaining === 0 : ticked || (row.done && !cleared));
  const source = manual ? (ticked || cleared ? "manual" : "authored") : "inventory";

  const spends: ResolvedSpend[] = row.alt
    ? altSpends(row.alt).map((spend) => ({
        currency: spend.currency,
        amount: spend.amount,
        value: parseQuantity(spend.amount),
      }))
    : [];

  return {
    done,
    row: {
      id,
      label: row.label,
      note: row.note,
      qty:
        row.qty === null
          ? null
          : {
              required,
              owned: owned ?? 0,
              remaining,
              text: done ? formatQuantity(required) : formatQuantity(remaining),
              requiredText: formatQuantity(required),
              tracked,
            },
      alt: row.alt ? { text: altText(row.alt), spends, taken: answers.altsTaken.has(id) } : null,
      done,
      source,
      manual,
    },
  };
}

function foundryLive(
  group: PlanGroup,
  itemName: string,
  state: PlayerState,
  now: number,
): ResolvedLive | null {
  let soonest: number | null = null;
  let found = false;
  for (const row of group.rows) {
    const build = pendingBuildFor(state, row.label, itemName);
    if (!build) continue;
    found = true;
    if (build.endsAt !== null && (soonest === null || build.endsAt < soonest))
      soonest = build.endsAt;
  }
  // Waiting means a timer somebody started. An unbuilt blueprint is work, not a
  // wait, so a foundry group with nothing in the queue carries no live block.
  if (!found) return null;
  const text = soonest === null ? "building" : `building, ${formatGap(soonest - now)} left`;
  return { state: "waiting", text, resolved: true };
}

function resolveLive(
  group: PlanGroup,
  itemName: string,
  state: PlayerState,
  context: PlanContext,
  now: number,
): ResolvedLive | null {
  if (group.type === "foundry" || group.type === "craft") {
    return foundryLive(group, itemName, state, now);
  }
  // Dojo research state is clan data no inventory payload carries, so a research
  // group can never be shown as a running timer.
  if (group.type === "research") return null;
  if (group.type === "vendor" && group.live) {
    return { state: "waiting", text: group.live.text, resolved: false };
  }
  return resolveCycleLive(group, context.world, now);
}

function flow(currency: string, authored: string, value: number): ResolvedFlow {
  return { currency, amount: formatQuantity(value), authoredAmount: authored, value };
}

/** A row naming the currency is the more specific statement, and the two figures
 *  read as a contradiction side by side, so the header line stands down. */
function namesCurrency(group: PlanGroup, currency: string): boolean {
  const needle = currency.toLowerCase();
  return group.rows.some((row) => row.label.toLowerCase().includes(needle));
}

/** `tier` is handed in rather than read off the plan: the letter belongs to the
 *  ranking table and the player's override, never to the authored file. */
export function resolvePlan(
  plan: AuthoredPlan,
  context: PlanContext,
  tier: string | null = null,
): ResolvedPlan {
  const now = context.now ?? Date.now();
  const state = readPlayerState(context.inventory, context.itemDb);
  const answers = {
    done: new Set(context.manualDone ?? []),
    cleared: new Set(context.manualCleared ?? []),
    altsTaken: new Set(context.altsTaken ?? []),
  };
  const itemName = plan.name;
  const lookup = context.resources ?? resourceEntry;
  const entries = planEntries(plan, lookup);
  const planGroups = entries.map((entry) => entry.group);

  const rowsByGroup: ResolvedRow[][] = [];
  const doneByGroup: boolean[] = [];

  planGroups.forEach((group, groupIndex) => {
    const rows: ResolvedRow[] = [];
    let allDone = true;
    group.rows.forEach((row, rowIndex) => {
      const result = resolveRow(
        row,
        entries[groupIndex].rowId(rowIndex),
        itemName,
        state,
        lookup,
        answers,
      );
      rows.push(result.row);
      if (!result.done) allDone = false;
    });
    rowsByGroup.push(rows);
    doneByGroup.push(group.skip !== null || allDone);
  });

  const earned = new Map<string, number>();
  const spent = new Map<string, number>();
  const outstanding = new Map<string, number>();
  // An alias such as Höllars books under its target, so the ledger has one line.
  const add = (table: Map<string, number>, currency: string, value: number): void => {
    const name = lookup(currency)?.name ?? currency;
    table.set(name, (table.get(name) ?? 0) + value);
  };

  planGroups.forEach((group, groupIndex) => {
    if (group.earns) add(earned, group.earns.currency, parseQuantity(group.earns.amount));
    const rows = rowsByGroup[groupIndex];
    for (const spend of group.spends) {
      const total = parseQuantity(spend.amount);
      add(spent, spend.currency, total);
      if (group.skip !== null) continue;
      const shares = rowShares(group, total);
      if (shares) {
        rows.forEach((row, rowIndex) => {
          if (!row.done) add(outstanding, spend.currency, shares[rowIndex]);
        });
      } else if (!doneByGroup[groupIndex]) {
        add(outstanding, spend.currency, total);
      }
    }
    for (const row of rows) {
      if (!row.alt?.taken) continue;
      for (const spend of row.alt.spends) {
        add(spent, spend.currency, spend.value);
        if (!row.done) add(outstanding, spend.currency, spend.value);
      }
    }
  });

  // A spent currency the plan lists as a material is banked by that material's farm.
  const banked = new Set(earned.keys());
  for (const material of plan.materials ?? []) {
    const name = lookup(material.label)?.name ?? material.label;
    if (spent.has(name) && !banked.has(name)) add(earned, name, parseQuantity(material.qty));
  }

  const eras = planEras(planGroups);
  const unresolved = new Set<PlanFactKind>();
  const standingByGroup = standingOwners(planGroups);

  const groups: ResolvedGroup[] = planGroups.map((group, groupIndex) => {
    const rows = rowsByGroup[groupIndex];
    const facts = groupFacts(group, {
      state,
      world: context.world,
      itemName,
      eras,
      outstanding,
      standing: standingByGroup.get(groupIndex) ?? [],
      now,
    });
    for (const kind of facts.unresolved) unresolved.add(kind);
    if (group.type === "research") unresolved.add("foundry");

    const live = resolveLive(group, itemName, state, context, now);
    const earns = group.earns && !namesCurrency(group, group.earns.currency) ? group.earns : null;
    const earnedTotal = earns
      ? (outstanding.get(lookup(earns.currency)?.name ?? earns.currency) ?? 0)
      : 0;

    return {
      id: entries[groupIndex].id,
      type: group.type,
      place: group.place,
      sub: group.sub,
      activity: group.activity,
      meta: group.meta,
      mode: group.mode,
      live,
      skip: group.skip,
      earns: earns
        ? earnedTotal > 0
          ? flow(earns.currency, earns.amount, earnedTotal)
          : flow(earns.currency, earns.amount, parseQuantity(earns.amount))
        : null,
      spends: group.spends.map((spend) =>
        flow(spend.currency, spend.amount, parseQuantity(spend.amount)),
      ),
      map: group.map,
      mapReady: group.map !== null && MAPS_READY.has(group.map),
      rows,
      conditions: group.conditions,
      bonuses: group.bonuses,
      disclosures: group.disclosures,
      facts: facts.facts,
      done: doneByGroup[groupIndex],
      remaining: group.skip !== null ? 0 : rows.filter((row) => !row.done).length,
    };
  });

  const currencies = new Set([...earned.keys(), ...spent.keys()]);
  const ledger: ResolvedLedgerEntry[] = [...currencies].map((currency) => ({
    currency,
    earned: earned.has(currency) ? (earned.get(currency) ?? 0) : null,
    spent: spent.get(currency) ?? 0,
    outstanding: outstanding.get(currency) ?? 0,
    paired: earned.has(currency),
  }));

  let total = 0;
  let done = 0;
  groups.forEach((group) => {
    if (group.skip !== null) return;
    total += group.rows.length;
    done += group.rows.filter((row) => row.done).length;
  });

  return {
    name: plan.name,
    kind: plan.kind,
    tier,
    effort: plan.effort,
    tradeable: plan.tradeable,
    progress: context.progress
      ? { ...context.progress, resolved: true }
      : {
          have: plan.progress.have,
          need: plan.progress.need,
          unit: plan.progress.unit,
          ready: plan.progress.have >= plan.progress.need,
          resolved: false,
        },
    badges: plan.badges,
    prices: plan.prices,
    groups,
    ledger,
    steps: { done, total },
    authored: true,
    unresolved: [...unresolved],
  };
}
