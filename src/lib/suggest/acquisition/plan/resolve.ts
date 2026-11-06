import { baseMapKey } from "../../../maps/registry.js";
import { groupFacts, planEras, standingOwners } from "./facts.js";
import { formatGap, resolveCycleLive } from "./live.js";
import {
  craftVerb,
  craftsShort,
  materialGroups,
  rowShares,
  sourceText,
  timesPaid,
  unearnedNeeds,
} from "./materials.js";
import { resolveShop } from "./shop.js";
import {
  resourceEntry,
  sourceQuest,
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
  blueprintFor,
  formatQuantity,
  itemsForLabel,
  ownedForLabel,
  parseQuantity,
  pendingBuildFor,
  questDoneForLabel,
  readBalance,
  readLabel,
  readPlayerState,
  type PlayerState,
} from "./state.js";
import { afterQuestRoute, planQuestDone } from "./data.js";
import { rankMet, rankTitle } from "./ranks.js";
import { groupDone, settleRanks, standingLinks, stepCount } from "./settle.js";
import { placeTips, type AnchorGroup } from "../tips/anchor.js";
import { tipsFor } from "../tips/data.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../types/inventory.js";
import { foundryBuilds, partDemand, startingBill } from "../parts.js";
import type { PartPlan, PartState } from "../types.js";
import type {
  PlanContext,
  PlanFactKind,
  ResolvedCraft,
  ResolvedFlow,
  ResolvedGroup,
  ResolvedLedgerEntry,
  ResolvedLive,
  ResolvedOwed,
  ResolvedPick,
  ResolvedPlan,
  ResolvedPurchase,
  ResolvedQuest,
  ResolvedRoute,
  ResolvedRow,
  ResolvedSpend,
} from "./types.js";

const CREDITS = "Credits";
const STANDING = /standing$/i;

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
 *  spending group at the store's vendor ("SMOKEFINGER, FORTUNA" for Smokefinger).
 *  A group that only buys rank-ups buys nothing the store sells, and a vendor
 *  group buys no material sold by the unit, such as Gyromag Systems. */
function boughtBy(
  entries: readonly PlanEntry[],
): (label: string, source: ResourceSource, blueprint: boolean) => boolean {
  const labels = new Set(
    entries.flatMap((entry) => entry.group.rows.map((row) => row.label.trim().toLowerCase())),
  );
  const vendors = entries
    .filter((entry) => entry.group.spends.length > 0)
    .filter((entry) => entry.group.rows.some((row) => !row.rank))
    .map((entry) => `${entry.group.place} ${entry.group.sub ?? ""}`.toLowerCase());
  return (label, source, blueprint) => {
    if (labels.has(`${label.trim().toLowerCase()} blueprint`)) return true;
    if (!blueprint) return false;
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
  copies: number,
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
  const owned = (label: string): number => readLabel(state, label, plan.name, lookup) ?? 0;
  const grouped = (list: typeof needs): PlanGroup[] =>
    materialGroups(list, lookup, boughtBy(authored), owned);
  const listed = grouped(needs);
  const unearned = unearnedNeeds(
    authored.map((entry) => entry.group),
    listed,
    needs,
    copies,
    lookup,
  );
  const all = unearned.length > 0 ? grouped([...needs, ...unearned]) : listed;
  if (all.length === 0) return authored;
  const materials: PlanEntry[] = all.map((group, groupIndex) => ({
    group,
    id: `m${groupIndex}`,
    rowId: (rowIndex) => `m:${group.rows[rowIndex].label.trim().toLowerCase()}`,
    route: null,
  }));
  const build = authored.findIndex(isBuildStep);
  const at = build === -1 ? authored.length : build;
  return [...authored.slice(0, at), ...materials, ...authored.slice(at)];
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

/** A crafted material: its verb, and the blueprints the crafts still short take,
 *  one in all when the blueprint is reusable; none where the plan buys it by hand. */
function resolveCraft(
  row: ResolvedRow,
  state: PlayerState,
  itemDb: Record<string, ItemDbEntry>,
  lookup: ResourceLookup,
): ResolvedCraft | null {
  const entry = lookup(row.label);
  if (entry?.kind !== "craft") return null;
  if (entry.best?.buy && !row.purchase) return { verb: craftVerb(entry), blueprints: null };
  const crafts = craftsShort(row.qty?.remaining ?? 0, entry);
  const held = blueprintFor(state, itemDb, row.label);
  const reusable = held?.reusable === true || row.purchase?.reusable === true;
  return {
    verb: craftVerb(entry),
    blueprints: {
      need: reusable ? Math.min(1, crafts) : crafts,
      held: row.qty?.tracked ? (held?.held ?? null) : null,
    },
  };
}

function resolveQuest(
  label: string,
  state: PlayerState,
  lookup: ResourceLookup,
): ResolvedQuest | null {
  const name = sourceQuest(lookup(label)?.best ?? null);
  return name ? { name, done: questDoneForLabel(state, name) } : null;
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
  const entry = lookup(row.label);
  const currency =
    entry?.kind === "currency" || entry?.kind === "standing" || STANDING.test(row.label);
  const read = (): number | null =>
    currency
      ? readBalance(state, inventory, entry?.name ?? row.label, itemName)
      : readLabel(state, row.label, itemName, lookup);
  const owned = answered !== null ? null : (part?.owned ?? read());
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
      ...(row.rank ? { rank: row.rank } : {}),
      ...(row.task ? { task: true } : {}),
      ...(currency ? { currency: true } : {}),
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

/** What the open rows of open groups still owe, by ledger currency; a done group owes nothing. */
export function outstandingOf(
  groups: readonly Pick<ResolvedGroup, "done" | "owes" | "rows">[],
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (owes: readonly ResolvedOwed[] | undefined): void => {
    for (const { currency, value } of owes ?? []) {
      out.set(currency, (out.get(currency) ?? 0) + value);
    }
  };
  for (const group of groups.filter((entry) => !entry.done)) {
    add(group.owes);
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
  const entries = planEntries(plan, lookup, quantities, state, afterQuest, copies);
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

  // An alias such as Hollars books under its target, so the ledger has one line.
  const ledgerName = (currency: string): string => lookup(currency)?.name ?? currency;
  const links = standingLinks(
    planGroups,
    (groupIndex, rowIndex) => entries[groupIndex].rowId(rowIndex),
    ledgerName,
    (label) => itemsForLabel(state, label, itemName) !== null || lookup(label) !== null,
  );

  const resolvedRows: ResolvedRow[][] = [];
  const partRows: boolean[][] = [];

  planGroups.forEach((group, groupIndex) => {
    const rows: ResolvedRow[] = [];
    const isPart: boolean[] = [];
    const build = group.type === "foundry" || group.type === "craft";
    group.rows.forEach((row, rowIndex) => {
      const id = entries[groupIndex].rowId(rowIndex);
      const part = row.assembled ? assembled(row) : partOf(row.label, build);
      const result = resolveRow(row, id, itemName, state, lookup, answers, part, context.inventory);
      if (row.buy) {
        result.row.purchase = resolvePurchase(
          { ...row.buy, rank: row.buy.rank ?? links.ranks.get(id) ?? null },
          row.label,
          state,
          context.itemDb,
          context.inventory,
        );
      }
      const unlocks = links.unlocks.get(id);
      if (unlocks) result.row.unlocks = unlocks;
      const paidAt = links.paidAt.get(id);
      if (paidAt) result.row.paidAt = paidAt;
      const material = entries[groupIndex].route === null;
      const craft = material ? resolveCraft(result.row, state, context.itemDb, lookup) : null;
      if (craft) result.row.craft = craft;
      const quest = material ? resolveQuest(row.label, state, lookup) : null;
      if (quest) result.row.quest = quest;
      rows.push(result.row);
      isPart.push(part !== null);
    });
    resolvedRows.push(rows);
    partRows.push(isPart);
  });
  // Rank-ups settle off the purchases first, so no settled group is left owing.
  const rowsByGroup = settleRanks(
    planGroups.map((group, groupIndex) => ({ skip: group.skip, rows: resolvedRows[groupIndex] })),
  );
  const doneByGroup = planGroups.map((group, groupIndex) =>
    groupDone({
      skip: group.skip,
      rows: rowsByGroup[groupIndex],
      buys: links.buys.get(groupIndex),
    }),
  );

  const earned = new Map<string, number>();
  const spent = new Map<string, number>();
  const add = (table: Map<string, number>, currency: string, value: number): void => {
    const name = ledgerName(currency);
    table.set(name, (table.get(name) ?? 0) + value);
  };
  const owe = (owes: ResolvedOwed[], currency: string, value: number): void => {
    if (value === 0) return;
    owes.push({ currency: ledgerName(currency), value });
  };

  const material = (groupIndex: number): boolean => entries[groupIndex].route === null;
  const buys = (groupIndex: number, row: ResolvedRow): number =>
    timesPaid(row.purchase?.reusable === true, material(groupIndex), copies);
  // A part row still owes only the builds it is short for; every other row owes all of them.
  const openCopies = (groupIndex: number, rowIndex: number): number => {
    const row = rowsByGroup[groupIndex][rowIndex];
    if (!partRows[groupIndex][rowIndex] || !row.qty) return buys(groupIndex, row);
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
          ? shares.reduce((sum, share, index) => sum + share * buys(groupIndex, rows[index]), 0)
          : authored * timesPaid(false, material(groupIndex), copies),
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
  // A spent currency nothing earned or listed farms as the material made for it.
  for (const entry of entries.filter((item) => item.route === null)) {
    for (const row of entry.group.rows) {
      const name = ledgerName(row.label);
      if (spent.has(name) && !earned.has(name)) add(earned, name, parseQuantity(row.qty));
    }
  }

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
    const earns = group.earns;
    const earnedTotal = earns ? (outstanding.get(ledgerName(earns.currency)) ?? 0) : 0;
    const held = earns
      ? readBalance(state, context.inventory, ledgerName(earns.currency), itemName)
      : null;
    const owes = groupOwes[groupIndex];
    const buys = links.buys.get(groupIndex);

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
      spends: groupSpends(group, rows, timesPaid(false, material(groupIndex), copies), ledgerName),
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
      ...(buys ? { buys } : {}),
      remaining: doneByGroup[groupIndex] ? 0 : rows.filter((row) => !row.done).length,
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
      copies,
    }),
    sequence: plan.sequence === true,
    steps: stepCount(groups),
    unresolved: [...unresolved],
  };
}
