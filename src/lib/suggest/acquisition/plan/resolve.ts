import { baseMapKey } from "../../../maps/registry.js";
import { groupFacts, planEras, standingOwners } from "./facts.js";
import { formatGap, resolveCycleLive } from "./live.js";
import { materialGroups, sourceText } from "./materials.js";
import { resolveShop } from "./shop.js";
import {
  resourceEntry,
  type ResourceEntry,
  type ResourceLookup,
  type ResourceSource,
} from "./resources.js";
import {
  altSpends,
  altText,
  type AuthoredPlan,
  type PlanAfterQuest,
  type PlanCurrency,
  type PlanGroup,
  type PlanPick,
  type PlanPurchase,
  type PlanRow,
} from "./schema.js";
import {
  assembledFrom,
  balanceFor,
  blueprintFor,
  formatQuantity,
  itemsForLabel,
  ownedForLabel,
  parseQuantity,
  pendingBuildFor,
  questDoneForLabel,
  readLabel,
  readPlayerState,
  type PlayerState,
} from "./state.js";
import { afterQuestRoute, planQuestDone } from "./data.js";
import { rankMet, rankTitle } from "./ranks.js";
import { placeTips, type AnchorGroup } from "../tips/anchor.js";
import { tipsFor } from "../tips/data.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../types/inventory.js";
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
  ResolvedPick,
  ResolvedPlan,
  ResolvedPurchase,
  ResolvedRoute,
  ResolvedRow,
  ResolvedSpend,
} from "./types.js";

const CREDITS = "Credits";

interface PlanEntry {
  group: PlanGroup;
  id: string;
  rowId: (rowIndex: number) => string;
  /** Which route the group walks; null for a group the store builds. */
  route: AnchorGroup["route"];
}

function withRefTips(group: PlanGroup, lookup: ResourceLookup): PlanGroup {
  const tips = group.ref ? (lookup(group.ref)?.tips ?? []) : [];
  if (tips.length === 0) return group;
  return { ...group, bonuses: [...new Set([...group.bonuses, ...tips])] };
}

const QUEST_SPENT = "Quest done; it rewards once";

/** A build a quest already paid out is not where the open route ends up. */
function isBuildStep(entry: PlanEntry): boolean {
  return (
    entry.group.skip === null && (entry.group.type === "craft" || entry.group.type === "foundry")
  );
}

/** A material's blueprint the plan already buys by hand: a row naming it, or a
 *  spending group at the store's vendor ("SMOKEFINGER, FORTUNA" for Smokefinger). */
function boughtBy(
  entries: readonly PlanEntry[],
): (label: string, source: ResourceSource) => boolean {
  const labels = new Set(
    entries.flatMap((entry) => entry.group.rows.map((row) => row.label.trim().toLowerCase())),
  );
  const vendors = entries
    .filter((entry) => entry.group.spends.length > 0)
    .map((entry) => `${entry.group.place} ${entry.group.sub ?? ""}`.toLowerCase());
  return (label, source) => {
    if (labels.has(`${label.trim().toLowerCase()} blueprint`)) return true;
    const vendor = source.sub?.trim().toLowerCase();
    return Boolean(vendor) && vendors.some((where) => where.includes(vendor ?? ""));
  };
}

/** An authored row's id carries its label beside its position, so a tick stored
 *  before the file moved or renamed the row matches nothing rather than another row. */
const rowKey = (group: string, rowIndex: number, label: string): string =>
  `${group}:${rowIndex}:${label.trim().toLowerCase()}`;

/** Stored ticks are keyed by row id: an authored row by position and label, and a
 *  material row, which moves whenever the store does, by its label alone. */
function planEntries(
  plan: AuthoredPlan,
  lookup: ResourceLookup,
  quantities: readonly (number | null)[],
  state: PlayerState,
  afterQuest: PlanAfterQuest | null,
): PlanEntry[] {
  const routes: PlanEntry[] = plan.groups.map((group, groupIndex) => ({
    group: withRefTips(
      group.quest && questDoneForLabel(state, group.quest) === true
        ? { ...group, skip: { reason: QUEST_SPENT } }
        : group,
      lookup,
    ),
    id: String(groupIndex),
    rowId: (rowIndex) => rowKey(String(groupIndex), rowIndex, group.rows[rowIndex].label),
    route: "chosen",
  }));
  const after: PlanEntry[] = (afterQuest?.groups ?? []).map((group, groupIndex) => ({
    group: withRefTips(group, lookup),
    id: `q${groupIndex}`,
    rowId: (rowIndex) => rowKey(`q${groupIndex}`, rowIndex, group.rows[rowIndex].label),
    route: "afterQuest",
  }));
  const step = routes.findIndex(isBuildStep);
  const before = step === -1 ? routes.length : step;
  const authored = [...routes.slice(0, before), ...after, ...routes.slice(before)];
  // A material the built parts have already used up is no step left to take.
  const needs = (plan.materials ?? []).flatMap((material, index) => {
    const qty = quantities[index] ?? parseQuantity(material.qty);
    return qty > 0 || quantities[index] === null
      ? [{ label: material.label, qty, note: material.note }]
      : [];
  });
  if (needs.length === 0) return authored;
  const materials: PlanEntry[] = materialGroups(needs, lookup, boughtBy(authored)).map(
    (group, groupIndex) => ({
      group,
      id: `m${groupIndex}`,
      rowId: (rowIndex) => `m:${group.rows[rowIndex].label.trim().toLowerCase()}`,
      route: null,
    }),
  );
  const build = authored.findIndex(isBuildStep);
  const at = build === -1 ? authored.length : build;
  return [...authored.slice(0, at), ...materials, ...authored.slice(at)];
}

/** Per-row shares of a group's spend, but only when the rows' prices add up to the
 *  group total exactly. A decomposition that does not check out is not used, so
 *  the ledger never invents a split. A pick row's price is outside the total. */
function rowShares(
  group: PlanGroup,
  currency: string,
  total: number,
  ledgerName: (currency: string) => string,
): number[] | null {
  const shares: number[] = [];
  for (const row of group.rows) {
    if (row.pick) {
      shares.push(0);
      continue;
    }
    if (!row.buy) return null;
    const times = row.buy.each ? parseQuantity(row.qty) : 1;
    const price = row.buy.price.find(
      (spend) => ledgerName(spend.currency) === ledgerName(currency),
    );
    shares.push(price ? parseQuantity(price.amount) * times : 0);
  }
  const sum = shares.reduce((carry, value) => carry + value, 0);
  return sum === total ? shares : null;
}

/** A row's purchase, read against the player. A reusable blueprint is settled
 *  once held, whether the store or DE's item data says it is reusable. */
function resolvePurchase(
  buy: PlanPurchase,
  label: string,
  state: PlayerState,
  itemDb: Record<string, ItemDbEntry>,
  inventory: RawInventoryData | null,
): ResolvedPurchase {
  const blueprint = buy.blueprint === true;
  const held = blueprint ? blueprintFor(state, itemDb, label) : null;
  const reusable = buy.reusable === true || held?.reusable === true;
  return {
    price: resolvedSpends(buy.price),
    each: buy.each === true,
    rank: buy.rank ? rankTitle(buy.rank) : null,
    rankMet: buy.rank ? rankMet(inventory, buy.rank) : null,
    blueprint,
    reusable,
    owned: reusable && (held?.held ?? 0) > 0,
  };
}

interface RowResult {
  row: ResolvedRow;
  done: boolean;
}

function resolvedSpends(spends: readonly PlanCurrency[]): ResolvedSpend[] {
  return spends.map((spend) => ({
    currency: spend.currency,
    amount: spend.amount,
    value: parseQuantity(spend.amount),
  }));
}

/** Holding the rank without the item means the pick went to something else. */
function resolvePick(pick: PlanPick, inventory: RawInventoryData | null): ResolvedPick {
  const met = rankMet(inventory, pick.rank);
  return {
    state: met === null ? "unknown" : met ? "spent" : "ahead",
    rank: rankTitle(pick.rank),
    spends: resolvedSpends(pick.spends),
  };
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

/** A row the card's part plan sizes: every build still owed, and what the player
 *  has toward them. */
interface RowCount {
  required: number;
  owned: number;
  copies: number;
}

function resolveRow(
  row: PlanRow,
  id: string,
  itemName: string,
  state: PlayerState,
  lookup: ResourceLookup,
  answers: { done: Set<string>; cleared: Set<string>; altsTaken: Set<string> },
  part: RowCount | null,
  inventory: RawInventoryData | null,
): RowResult {
  const required = part?.required ?? parseQuantity(row.qty);
  // A quest keychain or a syndicate rank is not an owned item, so the ownership
  // map answers 0 for a label the quest index or the rank table can answer.
  const answered =
    (row.rank ? rankMet(inventory, row.rank) : null) ?? questDoneForLabel(state, row.label);
  const owned =
    answered !== null ? null : (part?.owned ?? readLabel(state, row.label, itemName, lookup));
  const tracked = owned !== null;
  const remaining = Math.max(0, required - (owned ?? 0));

  // Nothing but the player can answer an untracked row, so their tick wins in
  // both directions and the authored flag is only where it starts.
  const ticked = answers.done.has(id);
  const cleared = answers.cleared.has(id);
  const manual = answered === null && !tracked;
  const done = answered ?? (tracked ? remaining === 0 : ticked || (row.done && !cleared));
  const source = manual ? (ticked || cleared ? "manual" : "authored") : "inventory";

  const spends = row.alt ? resolvedSpends(altSpends(row.alt)) : [];
  const pick = row.pick && !done ? resolvePick(row.pick, inventory) : null;
  const entry = lookup(row.label);
  const other = entry?.alternates.map(sourceText) ?? [];

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
      ...(pick ? { pick } : {}),
      done,
      source,
      manual,
      ...(entry?.common ? { common: true } : {}),
      ...(other.length > 0 ? { other } : {}),
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

/** The group's authored spends, plus the price of any rank-up pick already gone. */
function groupSpends(
  group: PlanGroup,
  rows: readonly ResolvedRow[],
  copies: number,
  ledgerName: (currency: string) => string,
): ResolvedFlow[] {
  const flows = group.spends.map((spend) =>
    flow(spend.currency, spend.amount, parseQuantity(spend.amount) * copies),
  );
  if (group.skip !== null) return flows;
  for (const row of rows) {
    if (row.pick?.state !== "spent") continue;
    for (const spend of row.pick.spends) {
      const at = flows.findIndex(
        (entry) => ledgerName(entry.currency) === ledgerName(spend.currency),
      );
      const value = spend.value * copies;
      if (at === -1) flows.push(flow(spend.currency, spend.amount, value));
      else {
        const { currency, authoredAmount } = flows[at];
        flows[at] = flow(currency, authoredAmount, flows[at].value + value);
      }
    }
  }
  return flows;
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
interface CardPlan {
  uniqueName: string;
  parts: PartPlan;
}

/** A reusable buy of the thing itself, not of a blueprint, is a tool no build uses up. */
function reusableTool(entry: ResourceEntry | null): boolean {
  return entry?.best?.buy?.reusable === true && entry.kind !== "craft";
}

/** Each authored material's figure as the card counts it, or null to keep the authored
 *  one. A recipe material takes the card's figure, net of what built parts consumed;
 *  Credits keep authored purchases and drop the foundry bill no longer owed; anything
 *  the recipe never asks for is the authored figure once per build. */
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
    const authored =
      parseQuantity(material.qty) * (reusableTool(lookup(material.label)) ? 1 : copies);
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

/** What each open build step makes: the first item its label names that has a
 *  recipe, or that a named blueprint builds. */
function buildItems(
  groups: readonly PlanGroup[],
  state: PlayerState,
  itemDb: Record<string, ItemDbEntry>,
  itemName: string,
): string[] {
  const made = groups
    .filter((group) => group.skip === null && (group.type === "foundry" || group.type === "craft"))
    .flatMap((group) => group.rows)
    .map((row) =>
      (itemsForLabel(state, row.label, itemName) ?? [])
        .map((uniqueName) =>
          itemDb[uniqueName]?.recipe ? uniqueName : itemDb[uniqueName]?.buildsProduct,
        )
        .find((uniqueName) => uniqueName !== undefined && itemDb[uniqueName]?.recipe),
    )
    .filter((uniqueName): uniqueName is string => uniqueName !== undefined);
  return [...new Set(made)];
}

/** A finished quest has spent the chosen route's one-time reward. */
function resolveRoutes(plan: AuthoredPlan, questDone: boolean): ResolvedRoute[] {
  const walking = questDone ? "afterQuest" : "chosen";
  return (plan.routes ?? []).map((route) => ({
    name: route.name,
    cost: route.cost,
    effort: route.effort,
    current: route.role === walking,
    ruledOut: questDone && route.role === "chosen",
  }));
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
  const afterQuest = afterQuestRoute(plan, state);
  const entries = planEntries(plan, lookup, quantities, state, afterQuest);
  const planGroups = entries.map((entry) => entry.group);
  let demand: Map<string, number> | null = null;
  let building: Map<string, number> | null = null;
  // A part inside a sub-assembly (Equinox's Night Neuroptics, inside the Night
  // Aspect) is not on the card, so it is sized from what the sub-assemblies
  // still to build need. A row naming its blueprint is covered by the built
  // part too.
  const nestedPart = (label: string, matches: readonly string[]): RowCount | null => {
    if (!card || !parts?.known) return null;
    demand ??= partDemand(card.uniqueName, context.inventory, context.itemDb, parts);
    building ??= parts.foundry ? foundryBuilds(context.inventory, context.itemDb) : new Map();
    for (const uniqueName of matches) {
      const product = context.itemDb[uniqueName]?.buildsProduct;
      const part = product && demand.has(product) ? product : uniqueName;
      const required = demand.get(part);
      if (required === undefined) continue;
      const held = matches.includes(part) ? 0 : (state.owned.get(part) ?? 0);
      const owned = (ownedForLabel(state, label, itemName) ?? 0) + (building.get(part) ?? 0);
      return { required, owned: owned + held, copies };
    }
    return null;
  };
  // Copies are what is still to build, so a built copy of the item counts for
  // none of them. Getting a part counts its blueprint in hand; building it does not.
  const partOf = (label: string, build: boolean): RowCount | null => {
    const matches = itemsForLabel(state, label, itemName);
    if (!card || !parts?.known || !matches) return null;
    if (matches.includes(card.uniqueName)) return { required: copies, owned: 0, copies };
    const part = partForRow(parts, context.itemDb, matches);
    if (part)
      return { required: part.required, owned: part.owned + (build ? 0 : part.held), copies };
    return nestedPart(label, matches);
  };

  const partLabels = planGroups.flatMap((group) => group.rows).map((row) => row.label);
  const assembled = (row: PlanRow): RowCount => ({
    required: parseQuantity(row.qty),
    owned: assembledFrom(state, partLabels, itemName),
    copies: 1,
  });

  const rowsByGroup: ResolvedRow[][] = [];
  const partRows: boolean[][] = [];
  const doneByGroup: boolean[] = [];

  planGroups.forEach((group, groupIndex) => {
    const rows: ResolvedRow[] = [];
    const isPart: boolean[] = [];
    let allDone = true;
    const build = group.type === "foundry" || group.type === "craft";
    group.rows.forEach((row, rowIndex) => {
      const part = row.assembled ? assembled(row) : partOf(row.label, build);
      const result = resolveRow(
        row,
        entries[groupIndex].rowId(rowIndex),
        itemName,
        state,
        lookup,
        answers,
        part,
        context.inventory,
      );
      if (row.buy) {
        result.row.purchase = resolvePurchase(
          row.buy,
          row.label,
          state,
          context.itemDb,
          context.inventory,
        );
      }
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
  // An alias such as Hollars books under its target, so the ledger has one line.
  const ledgerName = (currency: string): string => lookup(currency)?.name ?? currency;
  const add = (table: Map<string, number>, currency: string, value: number): void => {
    const name = ledgerName(currency);
    table.set(name, (table.get(name) ?? 0) + value);
  };
  const owe = (owes: ResolvedOwed[], currency: string, value: number): void => {
    if (value === 0) return;
    owes.push({ currency: ledgerName(currency), value });
  };

  // Authored costs are one build's, but a reusable purchase is made once.
  const buys = (row: ResolvedRow): number => (row.purchase?.reusable ? 1 : copies);
  // A part row still owes only the builds it is short for; every other row owes all of them.
  const openCopies = (groupIndex: number, rowIndex: number): number => {
    const row = rowsByGroup[groupIndex][rowIndex];
    if (!partRows[groupIndex][rowIndex] || !row.qty) return buys(row);
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
      const authored = parseQuantity(spend.amount);
      // A reusable blueprint already held costs nothing, here or in the totals.
      const shares = rowShares(group, spend.currency, authored, ledgerName)?.map((share, index) =>
        rows[index].purchase?.owned ? 0 : share,
      );
      add(
        spent,
        spend.currency,
        shares
          ? shares.reduce((sum, share, index) => sum + share * buys(rows[index]), 0)
          : authored * copies,
      );
      if (group.skip !== null) continue;
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
        owe(owes, spend.currency, authored * Math.max(1, ...open));
      }
    }
    rows.forEach((row, rowIndex) => {
      const extra = [
        ...(row.alt?.taken ? row.alt.spends : []),
        ...(row.pick?.state === "spent" && group.skip === null ? row.pick.spends : []),
      ];
      for (const spend of extra) {
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
  const tips = placeTips(
    entries.map((entry) => ({ ...entry.group, route: entry.route })),
    (context.tips ?? tipsFor)(itemName),
  );

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
    const held = earns ? balanceFor(state, ledgerName(earns.currency), itemName) : null;
    const owes = groupOwes[groupIndex];

    return {
      id: entries[groupIndex].id,
      type: group.type,
      place: group.place,
      sub: group.sub,
      activity: group.activity,
      title: group.title ?? null,
      meta: group.meta,
      mode: group.mode,
      live,
      skip: group.skip,
      earns: earns
        ? {
            ...earnsFlow(
              earns.currency,
              earns.amount,
              ledgerName(earns.currency),
              parseQuantity(earns.amount) * copies,
              earnedTotal,
            ),
            ...(held === null ? {} : { held }),
          }
        : null,
      spends: groupSpends(group, rows, copies, ledgerName),
      map: group.map,
      mapReady: baseMapKey(group.map) !== null,
      rows,
      conditions: group.conditions,
      bonuses: group.bonuses,
      disclosures: group.disclosures,
      tips: tips.groups[groupIndex],
      facts: facts.facts,
      quest: group.quest ?? null,
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

  const materialRows = groups
    .filter((_, index) => entries[index].route === null)
    .flatMap((group) => group.rows);
  const crafting = (currency: string): number =>
    materialRows
      .filter((row) => ledgerName(row.label) === ledgerName(currency))
      .reduce((sum, row) => sum + (row.qty?.required ?? 0), 0);

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
    afterQuest: afterQuest ? { effort: afterQuest.effort, badges: afterQuest.badges } : null,
    routes: resolveRoutes(plan, planQuestDone(plan, state) === true),
    prices: plan.prices,
    groups,
    tips: tips.rest,
    sentiment: tips.sentiment,
    ledger,
    copies,
    builds: buildItems(planGroups, state, context.itemDb, itemName),
    shop: resolveShop(plan, groups, state, context, {
      crafting,
      got: (label) => partOf(label, false)?.owned ?? null,
    }),
    sequence: plan.sequence === true,
    steps: { done, total },
    unresolved: [...unresolved],
  };
}
