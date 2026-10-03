import { groupFacts, planEras, standingOwners } from "./facts.js";
import { formatGap, resolveCycleLive } from "./live.js";
import { materialGroups } from "./materials.js";
import { resourceEntry, type ResourceLookup } from "./resources.js";
import { altSpends, altText, type AuthoredPlan, type PlanGroup, type PlanRow } from "./schema.js";
import {
  formatQuantity,
  itemsForLabel,
  ownedForLabel,
  parseQuantity,
  pendingBuildFor,
  questDoneForLabel,
  readPlayerState,
  type PlayerState,
} from "./state.js";
import type { ItemDbEntry } from "../../../../types/inventory.js";
import { foundryBuilds, partDemand, startingBill } from "../parts.js";
import type { PartPlan, PartState } from "../types.js";
import type {
  PlanContext,
  PlanFactKind,
  ResolvedFlow,
  ResolvedGroup,
  ResolvedLedgerEntry,
  ResolvedLive,
  ResolvedOwed,
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
function planEntries(
  plan: AuthoredPlan,
  lookup: ResourceLookup,
  quantities: readonly (number | null)[],
): PlanEntry[] {
  const authored: PlanEntry[] = plan.groups.map((group, groupIndex) => ({
    group: withRefTips(group, lookup),
    id: String(groupIndex),
    rowId: (rowIndex) => `${groupIndex}:${rowIndex}`,
  }));
  // A material the built parts have already used up is no step left to take.
  const needs = (plan.materials ?? []).flatMap((material, index) => {
    const qty = quantities[index] ?? parseQuantity(material.qty);
    return qty > 0 || quantities[index] === null
      ? [{ label: material.label, qty, note: material.note }]
      : [];
  });
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

/** The card's part a row farms or builds; a blueprint row lands on the part its
 *  blueprint builds. Null for every other row, and for gear with no part plan. */
function partForRow(
  parts: PartPlan | null,
  itemDb: Record<string, ItemDbEntry>,
  matches: readonly string[] | null,
): PartState | null {
  if (!parts?.known || !matches) return null;
  const rows = [...(parts.main ? [parts.main] : []), ...parts.components];
  for (const uniqueName of matches) {
    const product = itemDb[uniqueName]?.buildsProduct;
    const part = rows.find((row) => row.uniqueName === uniqueName || row.uniqueName === product);
    if (part) return part;
  }
  return null;
}

/** How a part row counts: `required` overrides the authored figure, and
 *  `building` and `held` add to what the label's own items hold. */
interface RowPart {
  required: number | null;
  building: number;
  held: number;
  copies: number;
}

function resolveRow(
  row: PlanRow,
  id: string,
  itemName: string,
  state: PlayerState,
  lookup: ResourceLookup,
  answers: { done: Set<string>; cleared: Set<string>; altsTaken: Set<string> },
  part: RowPart | null,
): RowResult {
  // A part row is sized for every build the card counts, and a copy of the part
  // still in the foundry is one nobody needs to farm again.
  const required = part?.required ?? parseQuantity(row.qty) * (part?.copies ?? 1);
  // A quest keychain is not an owned item, so the ownership map answers 0 for a
  // label the quest index can answer properly.
  const quest = questDoneForLabel(state, row.label);
  const inventoryOwned =
    quest !== null
      ? null
      : lookup(row.label)?.name === CREDITS
        ? state.credits
        : ownedForLabel(state, row.label, itemName);
  const owned =
    inventoryOwned === null ? null : inventoryOwned + (part?.building ?? 0) + (part?.held ?? 0);
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
        row.qty === null && (part?.copies ?? 1) === 1
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

/** What a farm still has to bank: the plan's outstanding spend in its currency,
 *  or the whole figure once nothing is outstanding. */
export function earnsFlow(
  currency: string,
  authored: string,
  ledger: string,
  full: number,
  outstanding: number,
): ResolvedFlow {
  return { ...flow(currency, authored, outstanding > 0 ? outstanding : full), ledger, full };
}

/** What the open rows and groups still owe, by ledger currency. */
export function outstandingOf(
  groups: readonly Pick<ResolvedGroup, "done" | "owes" | "rows">[],
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (owes: readonly ResolvedOwed[] | undefined): void => {
    for (const { currency, value } of owes ?? []) {
      out.set(currency, (out.get(currency) ?? 0) + value);
    }
  };
  for (const group of groups) {
    if (!group.done) add(group.owes);
    for (const row of group.rows) if (!row.done) add(row.owes);
  }
  return out;
}

/** The card's part plan and the item it plans, which the plan page sizes to. */
export interface CardPlan {
  uniqueName: string;
  parts: PartPlan;
}

/** Each authored material's figure as the card counts it, or null to keep the
 *  authored one. A recipe material takes the card's own figure, which already
 *  leaves out what built parts consumed; Credits keep the authored purchases and
 *  drop the foundry bill the card no longer owes; anything else the recipe never
 *  asks for is the authored figure once per build. */
function materialQuantities(
  plan: AuthoredPlan,
  card: CardPlan | null,
  state: PlayerState,
  itemDb: Record<string, ItemDbEntry>,
  lookup: ResourceLookup,
): (number | null)[] {
  const materials = plan.materials ?? [];
  if (!card?.parts.known) return materials.map(() => null);
  const copies = card.parts.copies;
  const start = startingBill(card.uniqueName, itemDb, copies);
  const onCard = new Map(card.parts.materials.map((row) => [row.uniqueName, row.required]));
  return materials.map((material) => {
    const authored = parseQuantity(material.qty) * copies;
    if (lookup(material.label)?.name === CREDITS) {
      return Math.max(0, authored - (start.credits - card.parts.credits));
    }
    const matches = itemsForLabel(state, material.label, plan.name) ?? [];
    const recipe = matches.filter((uniqueName) => start.materials.has(uniqueName));
    if (recipe.length === 0) return authored;
    return recipe.reduce((sum, uniqueName) => sum + (onCard.get(uniqueName) ?? 0), 0);
  });
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
  card: CardPlan | null = null,
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
  const parts = card?.parts ?? null;
  const copies = parts?.copies ?? 1;
  const quantities = materialQuantities(plan, card, state, context.itemDb, lookup);
  const entries = planEntries(plan, lookup, quantities);
  const planGroups = entries.map((entry) => entry.group);
  let demand: Map<string, number> | null = null;
  let building: Map<string, number> | null = null;
  // A part inside a sub-assembly (Equinox's Night Neuroptics, inside the Night
  // Aspect) is not on the card, so it is sized from what the sub-assemblies
  // still to build need. A row naming its blueprint is covered by the built
  // part too.
  const nestedPart = (matches: readonly string[] | null): RowPart | null => {
    if (!card || !parts?.known || !matches) return null;
    demand ??= partDemand(card.uniqueName, context.inventory, context.itemDb, parts);
    building ??= parts.foundry ? foundryBuilds(context.inventory, context.itemDb) : new Map();
    for (const uniqueName of matches) {
      const product = context.itemDb[uniqueName]?.buildsProduct;
      const part = product && demand.has(product) ? product : uniqueName;
      const required = demand.get(part);
      if (required === undefined) continue;
      return {
        required,
        building: building.get(part) ?? 0,
        held: matches.includes(part) ? 0 : (state.owned.get(part) ?? 0),
        copies,
      };
    }
    return null;
  };
  const partOf = (label: string): RowPart | null => {
    const matches = itemsForLabel(state, label, itemName);
    const match = partForRow(parts, context.itemDb, matches);
    if (match && parts) return { required: null, building: match.building, held: 0, copies };
    return nestedPart(matches);
  };

  const rowsByGroup: ResolvedRow[][] = [];
  const partRows: boolean[][] = [];
  const doneByGroup: boolean[] = [];

  planGroups.forEach((group, groupIndex) => {
    const rows: ResolvedRow[] = [];
    const isPart: boolean[] = [];
    let allDone = true;
    group.rows.forEach((row, rowIndex) => {
      const part = partOf(row.label);
      const result = resolveRow(
        row,
        entries[groupIndex].rowId(rowIndex),
        itemName,
        state,
        lookup,
        answers,
        part,
      );
      rows.push(result.row);
      isPart.push(part !== null);
      if (!result.done) allDone = false;
    });
    rowsByGroup.push(rows);
    partRows.push(isPart);
    doneByGroup.push(group.skip !== null || allDone);
  });

  const earned = new Map<string, number>();
  const spent = new Map<string, number>();
  // An alias such as Höllars books under its target, so the ledger has one line.
  const ledgerName = (currency: string): string => lookup(currency)?.name ?? currency;
  const add = (table: Map<string, number>, currency: string, value: number): void => {
    const name = ledgerName(currency);
    table.set(name, (table.get(name) ?? 0) + value);
  };
  const owe = (owes: ResolvedOwed[], currency: string, value: number): void => {
    owes.push({ currency: ledgerName(currency), value });
  };

  // Authored costs are one build's. A part row still owes only the builds it is
  // short for; every other row owes all of them.
  const openCopies = (groupIndex: number, rowIndex: number): number => {
    const row = rowsByGroup[groupIndex][rowIndex];
    if (!partRows[groupIndex][rowIndex] || !row.qty) return copies;
    const perBuild = row.qty.required / copies;
    if (perBuild <= 0) return copies;
    return Math.max(1, Math.ceil(row.qty.remaining / perBuild));
  };

  const groupOwes: ResolvedOwed[][] = [];
  planGroups.forEach((group, groupIndex) => {
    if (group.earns) add(earned, group.earns.currency, parseQuantity(group.earns.amount) * copies);
    const rows = rowsByGroup[groupIndex];
    const rowOwes: ResolvedOwed[][] = rows.map(() => []);
    const owes: ResolvedOwed[] = [];
    for (const spend of group.spends) {
      const total = parseQuantity(spend.amount);
      add(spent, spend.currency, total * copies);
      if (group.skip !== null) continue;
      const shares = rowShares(group, total);
      if (shares) {
        rows.forEach((_, rowIndex) => {
          owe(
            rowOwes[rowIndex],
            spend.currency,
            shares[rowIndex] * openCopies(groupIndex, rowIndex),
          );
        });
      } else {
        const open = rows.map((_, rowIndex) => openCopies(groupIndex, rowIndex));
        owe(owes, spend.currency, total * Math.max(1, ...open));
      }
    }
    rows.forEach((row, rowIndex) => {
      if (!row.alt?.taken) return;
      for (const spend of row.alt.spends) {
        add(spent, spend.currency, spend.value * copies);
        owe(rowOwes[rowIndex], spend.currency, spend.value * openCopies(groupIndex, rowIndex));
      }
    });
    rows.forEach((row, rowIndex) => {
      if (rowOwes[rowIndex].length > 0) row.owes = rowOwes[rowIndex];
    });
    groupOwes.push(owes);
  });
  const outstanding = outstandingOf(
    planGroups.map((_, groupIndex) => ({
      done: doneByGroup[groupIndex],
      owes: groupOwes[groupIndex],
      rows: rowsByGroup[groupIndex],
    })),
  );

  // A spent currency the plan lists as a material is banked by that material's farm.
  const banked = new Set(earned.keys());
  (plan.materials ?? []).forEach((material, index) => {
    const name = ledgerName(material.label);
    const qty = quantities[index] ?? parseQuantity(material.qty);
    if (spent.has(name) && !banked.has(name)) add(earned, name, qty);
  });

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
    const earnedTotal = earns ? (outstanding.get(ledgerName(earns.currency)) ?? 0) : 0;
    const owes = groupOwes[groupIndex];

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
        ? earnsFlow(
            earns.currency,
            earns.amount,
            ledgerName(earns.currency),
            parseQuantity(earns.amount) * copies,
            earnedTotal,
          )
        : null,
      spends: group.spends.map((spend) =>
        flow(spend.currency, spend.amount, parseQuantity(spend.amount) * copies),
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
      ...(owes.length > 0 ? { owes } : {}),
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
    source: plan.source,
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
    unresolved: [...unresolved],
  };
}
