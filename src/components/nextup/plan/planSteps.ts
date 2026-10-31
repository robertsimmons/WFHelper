import { formatNumber } from "../../../lib/format.js";
import { isSubsumableFrame } from "../../../lib/helminth.js";
import type { Translator } from "../../../lib/i18n.js";
import { buildWikiUrl } from "../../../lib/wikiUrl.js";
import type {
  ItemTip,
  ResolvedGroup,
  ResolvedPlan,
  ResolvedRow,
} from "../../../lib/suggest/acquisition/plan/index.js";
import type { PlanDisclosure } from "../../../lib/suggest/acquisition/plan/schema.js";
import { isPartSet, setTitle } from "../../../lib/suggest/acquisition/plan/setTitle.js";
import type { ResolvedOwed, ResolvedSpend } from "../../../lib/suggest/acquisition/plan/types.js";
import {
  farmNeed,
  type ResolvedShop,
  type ShopTotal,
} from "../../../lib/suggest/acquisition/shops/picker.js";

export type PlanSectionKey = "get" | "farm" | "build";

type PlanLineKind = "quest" | "buy" | "shop" | "drop" | "earn" | "material" | "basics" | "build";

/** `have` is null where nothing the app reads holds the balance. */
export interface PlanCount {
  have: number | null;
  need: number;
}

interface PlanPart {
  /** The plan row the part ticks. */
  id: string;
  label: string;
  done: boolean;
  note: string | null;
  /** Shown when a set's parts are priced apart. */
  cost: string | null;
  count: PlanCount | null;
}

interface PlanAlt {
  id: string;
  label: string;
  text: string;
  /** An alternative with a price the ledger counts, which the player can take. */
  offer: boolean;
  taken: boolean;
}

/** Everything a line holds back until it is opened. */
interface PlanDrawer {
  where: string | null;
  rates: string[];
  notes: string[];
  other: string[];
  disclosures: PlanDisclosure[];
  tips: ItemTip[];
  alts: PlanAlt[];
  /** The rows a line stands for when the main view shows only the line. */
  parts: PlanPart[];
  /** The plan's first step, whose drawer carries what the surface adds about the item. */
  lead: boolean;
  map: { key: string; ready: boolean } | null;
  wiki: string;
}

export interface PlanLine {
  id: string;
  kind: PlanLineKind;
  section: PlanSectionKey;
  title: string;
  /** The place a farm line shares a trip by. */
  place: string;
  cost: string | null;
  count: PlanCount | null;
  /** A drop's pickups, or a currency's rank-ups. */
  parts: PlanPart[];
  /** The Basics line's materials, one chip each. */
  chips: PlanLine[];
  /** A running foundry timer or another live state. */
  live: string | null;
  /** Opens the shop picker: the shop's buy line and the runs that bank its currency. */
  picker: boolean;
  /** The shop currency the line farms, whose count is the plan's need of it. */
  farms: string | null;
  /** The plan rows the line ticks; empty for a line the inventory or a shop answers. */
  rowIds: string[];
  done: boolean;
  blocked: boolean;
  next: boolean;
  drawer: PlanDrawer;
}

/** Two or more open farm lines at one place, run together. */
interface PlanTrip {
  kind: "trip";
  id: string;
  place: string;
  lines: PlanLine[];
  next: boolean;
}

type PlanEntry = PlanLine | PlanTrip;

interface PlanSection {
  key: PlanSectionKey;
  entries: PlanEntry[];
}

export interface PlanModel {
  /** Only sections with something left to do. */
  sections: PlanSection[];
  done: PlanLine[];
  shop: ResolvedShop | null;
  copies: number;
}

/** What only the plan page wires into the steps: ticking rows and taking an alt.
 *  Maps and shop picks work on every surface. */
export interface PlanStepControls {
  onToggleDone: (rowIds: readonly string[], done: boolean) => void;
  onTakeAlt: (rowId: string) => void;
}

interface StepOptions {
  t: Translator;
}

const STANDING = /standing$/i;
const DROP_TYPES = new Set(["farm", "bounty", "boss", "relics", "fissure"]);
const SECTIONS: readonly PlanSectionKey[] = ["get", "farm", "build"];

const isMaterialGroup = (group: ResolvedGroup): boolean => group.id.startsWith("m");

/** "ROKY, FORTUNA" reads as "Roky, Fortuna"; a token carrying a digit is a code. */
function placeName(place: string): string {
  return place
    .split(/(\s+)/)
    .map((word) =>
      /\d/.test(word) || word.trim() === ""
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function priceText(currency: string, value: number, t: Translator): string {
  const amount = formatNumber(value);
  return STANDING.test(currency) ? t("dailies.standing", { amount }) : `${amount} ${currency}`;
}

function spendsText(spends: readonly (ResolvedSpend | ResolvedOwed)[], t: Translator): string {
  return spends.map((spend) => priceText(spend.currency, spend.value, t)).join(", ");
}

/** "Feverspine Blueprint" on the Feverspine plan is just its blueprint. */
function shortLabel(label: string, planName: string): string {
  const prefix = `${planName.toLowerCase()} `;
  if (!label.toLowerCase().startsWith(prefix)) return label;
  return capitalized(label.slice(prefix.length).trim()) || label;
}

function flowCurrencies(group: ResolvedGroup): Set<string> {
  const names = new Set<string>();
  for (const spend of group.spends) names.add(spend.currency.toLowerCase());
  for (const row of group.rows) {
    for (const owed of row.owes ?? []) names.add(owed.currency.toLowerCase());
  }
  for (const owed of group.owes ?? []) names.add(owed.currency.toLowerCase());
  return names;
}

/** A group that banks a currency reads before the first group that spends it,
 *  whatever order the plan file lists them in. */
function displayOrder(groups: readonly ResolvedGroup[]): ResolvedGroup[] {
  const out = [...groups];
  for (const earner of groups) {
    const earns = earner.earns;
    if (!earns) continue;
    const names = [earns.currency, earns.ledger ?? earns.currency].map((name) =>
      name.toLowerCase(),
    );
    const at = out.indexOf(earner);
    const spender = out.findIndex((group, index) => {
      if (index >= at || group === earner) return false;
      const spent = flowCurrencies(group);
      return names.some((name) => spent.has(name));
    });
    if (spender === -1) continue;
    out.splice(at, 1);
    out.splice(spender, 0, earner);
  }
  return out;
}

/** A banking step is finished once nothing the plan still buys owes its currency. */
function paidOff(group: ResolvedGroup, plan: ResolvedPlan): boolean {
  const ledger = group.earns?.ledger;
  if (!ledger) return false;
  const line = plan.ledger.find((entry) => entry.currency === ledger);
  return line !== undefined && line.spent > 0 && line.outstanding === 0;
}

function rowCount(row: ResolvedRow): PlanCount | null {
  if (!row.qty) return null;
  return {
    have: row.qty.tracked ? Math.min(row.qty.owned, row.qty.required) : null,
    need: row.qty.required,
  };
}

/** The currency, when the plan's shop sells it. */
function shopCurrency(plan: ResolvedPlan, currency: string | null): string | null {
  const sold = plan.shop?.own.totals.some((line) => line.currency === currency) ?? false;
  return sold ? currency : null;
}

/** What the plan needs of a shop currency: the picks it counts and its crafting use. */
function shopCount(shop: ResolvedShop, currency: string): PlanCount {
  const line = shop.own.totals.find((entry) => entry.currency === currency);
  return { have: line?.balance ?? null, need: farmNeed(shop.own.totals, currency) };
}

/** A line farming a shop currency counts the plan's need of it; any other its
 *  own flow, or its one row. */
function farmCount(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  farms: string | null,
): PlanCount | null {
  if (farms && plan.shop) return shopCount(plan.shop, farms);
  const earns = group.earns;
  if (earns) return { have: earns.held ?? null, need: earns.value };
  return group.rows.length === 1 ? rowCount(group.rows[0]) : null;
}

/** A count with nothing needed draws nothing. */
const shown = (count: PlanCount | null): PlanCount | null =>
  count !== null && count.need > 0 ? count : null;

/** Nothing needed counts as met. */
const covered = (count: PlanCount | null): boolean =>
  count !== null && (count.need === 0 || (count.have !== null && count.have >= count.need));

/** A line farming a shop currency is done once its other pickups are and the
 *  plan's need of the currency is met. */
function farmDone(group: ResolvedGroup, farms: string, count: PlanCount | null): boolean {
  if (group.skip !== null) return true;
  return group.rows.every((row) => row.done || row.label === farms) && covered(count);
}

function drawer(
  group: ResolvedGroup,
  wikiName: string,
  extra: Partial<PlanDrawer> = {},
): PlanDrawer {
  const where = [placeName(group.place), group.sub].filter(Boolean).join(", ");
  return {
    where: where || null,
    rates: [group.activity, group.meta, group.mode, ...group.facts.map((fact) => fact.text)].filter(
      (text): text is string => Boolean(text),
    ),
    notes: [...group.conditions, ...group.bonuses],
    other: [],
    disclosures: group.disclosures,
    tips: group.tips,
    alts: group.rows.flatMap((row) =>
      row.alt
        ? [
            {
              id: row.id,
              label: row.label,
              text: row.alt.text,
              offer: row.alt.spends.length > 0,
              taken: row.alt.taken,
            },
          ]
        : [],
    ),
    parts: [],
    lead: false,
    map: group.map ? { key: group.map, ready: group.mapReady } : null,
    wiki: buildWikiUrl(wikiName),
    ...extra,
  };
}

function line(
  group: ResolvedGroup,
  fields: Pick<PlanLine, "id" | "kind" | "section" | "title" | "done" | "drawer"> &
    Partial<PlanLine>,
): PlanLine {
  return {
    place: placeName(group.place),
    cost: null,
    count: null,
    parts: [],
    chips: [],
    live: group.live?.text ?? null,
    picker: false,
    farms: null,
    rowIds: group.rows.map((row) => row.id),
    blocked: false,
    next: false,
    ...fields,
  };
}

const rowPart = (row: ResolvedRow, label = row.label): PlanPart => ({
  id: row.id,
  label,
  done: row.done,
  note: row.note,
  cost: null,
  count: null,
});

const rowNotes = (row: ResolvedRow, group: ResolvedGroup): string[] => [
  ...(row.note ? [row.note] : []),
  ...group.conditions,
  ...group.bonuses,
];

function rowCost(row: ResolvedRow, group: ResolvedGroup, t: Translator): string | null {
  if (row.pick) {
    return row.pick.state === "spent" ? spendsText(row.pick.spends, t) : t("nextUp.planPickReward");
  }
  const price = row.purchase?.price ?? [];
  if (price.length > 0) {
    const text = spendsText(price, t);
    return row.purchase?.each ? t("nextUp.stepEach", { price: text }) : text;
  }
  if (row.owes?.length) return spendsText(row.owes, t);
  return group.rows.length === 1 && group.spends.length > 0 ? spendsText(group.spends, t) : null;
}

/** A material farms in Farm; a crafted one whose blueprint is bought also buys
 *  that blueprint in Get. A shop currency counts the plan's whole need of it. */
function materialLines(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  t: Translator,
  commons: Set<string>,
): PlanLine[] {
  return group.rows.flatMap((row) => {
    if (row.common) commons.add(row.id);
    const purchase = row.purchase;
    const farms = shopCurrency(plan, row.label);
    const count = farms && plan.shop ? shopCount(plan.shop, farms) : rowCount(row);
    const farm = line(group, {
      id: row.id,
      kind: "material",
      section: "farm",
      title: row.label,
      count: shown(count),
      cost: purchase && !purchase.blueprint ? rowCost(row, group, t) : null,
      picker: farms !== null,
      farms,
      rowIds: [row.id],
      done: farms ? covered(count) : row.done,
      drawer: drawer(group, row.label, { notes: rowNotes(row, group), other: row.other ?? [] }),
    });
    if (!purchase?.blueprint) return [farm];
    const buy = line(group, {
      id: `${row.id}:bp`,
      kind: "buy",
      section: "get",
      title: t("nextUp.lineBuyBlueprint", { name: row.label }),
      cost: spendsText(purchase.price, t),
      rowIds: [],
      done: purchase.owned || row.done,
      blocked: purchase.rankMet === false,
      drawer: drawer(group, row.label),
    });
    return [buy, farm];
  });
}

const priceKey = (row: ResolvedRow): string =>
  (row.purchase?.price ?? []).map((spend) => `${spend.value} ${spend.currency}`).join(",");

/** One price every row pays, or null when the rows differ or carry none. */
function sharedPrice(rows: readonly ResolvedRow[]): ResolvedSpend[] | null {
  const key = priceKey(rows[0]);
  return key !== "" && rows.every((row) => priceKey(row) === key)
    ? (rows[0].purchase?.price ?? null)
    : null;
}

/** What the open rows still cost, currency by currency. */
function openTotal(rows: readonly ResolvedRow[]): ResolvedOwed[] {
  const totals = new Map<string, number>();
  for (const row of rows.filter((entry) => !entry.done)) {
    for (const spend of row.purchase?.price ?? []) {
      totals.set(spend.currency, (totals.get(spend.currency) ?? 0) + spend.value);
    }
  }
  return [...totals].map(([currency, value]) => ({ currency, value }));
}

/** A row's units: its quantity, or one; a done row has them all. */
function unitCount(row: ResolvedRow): PlanCount {
  const need = row.qty?.required ?? 1;
  const owned = row.qty?.tracked ? Math.min(row.qty.owned, need) : 0;
  return { have: row.done ? need : owned, need };
}

function partSetTitle(group: ResolvedGroup, itemName: string, t: Translator): string {
  const rows = group.rows.map((row) => ({
    label: row.label,
    blueprint: row.purchase?.blueprint ?? false,
  }));
  const title = setTitle({ ...group, rows }, itemName);
  switch (title.kind) {
    case "titled":
      return title.vendor === null
        ? title.title
        : t("nextUp.setAt", { title: title.title, vendor: placeName(title.vendor) });
    case "buyBlueprints":
      return t("nextUp.stepBuyBlueprintsAt", { place: placeName(title.vendor) });
    case "buy":
      return t("nextUp.stepBuyAt", { place: placeName(title.vendor) });
    case "buildPartsThen":
      return t("nextUp.stepBuildPartsThen", { name: title.item });
    case "buildParts":
      return t("nextUp.stepBuildParts");
  }
}

/** Two or more rows of one step over different parts read as one counted line;
 *  the drawer holds each part, priced when the parts' prices differ. */
function partSetLine(group: ResolvedGroup, plan: ResolvedPlan, t: Translator, done: boolean) {
  const build = group.type !== "vendor";
  const shared = sharedPrice(group.rows);
  const units = group.rows.map(unitCount);
  const count = {
    have: units.reduce((sum, unit) => sum + (unit.have ?? 0), 0),
    need: units.reduce((sum, unit) => sum + unit.need, 0),
  };
  const total = openTotal(group.rows);
  const open = group.rows.filter((row) => !row.done);
  return line(group, {
    id: group.id,
    kind: build ? "build" : "buy",
    section: build ? "build" : "get",
    title: partSetTitle(group, plan.name, t),
    cost: shared
      ? t("nextUp.stepEach", { price: spendsText(shared, t) })
      : total.length > 0
        ? spendsText(total, t)
        : null,
    count,
    done: done || open.length === 0,
    blocked: open.length > 0 && open.every((row) => row.purchase?.rankMet === false),
    drawer: drawer(group, plan.name, {
      parts: group.rows.map((row, index) => ({
        ...rowPart(row),
        cost: shared ? null : rowCost(row, group, t),
        count: units[index].need > 1 ? units[index] : null,
      })),
    }),
  });
}

function buyLines(group: ResolvedGroup, plan: ResolvedPlan, t: Translator, done: boolean) {
  return group.rows.map((row) => {
    const count = rowCount(row);
    return line(group, {
      id: row.id,
      kind: "buy",
      section: "get",
      title: t("nextUp.lineBuy", { name: row.label }),
      cost: rowCost(row, group, t),
      count: count && count.need > 1 ? count : null,
      rowIds: [row.id],
      done: done || row.done,
      blocked: row.purchase?.rankMet === false,
      drawer: drawer(group, plan.name, { notes: rowNotes(row, group) }),
    });
  });
}

function buildLines(group: ResolvedGroup, t: Translator, done: boolean): PlanLine[] {
  return group.rows.map((row) => {
    const count = rowCount(row);
    return line(group, {
      id: row.id,
      kind: "build",
      section: "build",
      title: t("nextUp.stepBuild", { name: row.label }),
      count: count && count.need > 1 ? count : null,
      rowIds: [row.id],
      done: done || row.done,
      drawer: drawer(group, row.label, { notes: rowNotes(row, group) }),
    });
  });
}

/** The currency a banking group pays into: its own, or a shop currency a row names. */
function bankedCurrency(group: ResolvedGroup, plan: ResolvedPlan): string | null {
  if (group.earns) return group.earns.ledger ?? group.earns.currency;
  return group.rows.find((row) => shopCurrency(plan, row.label))?.label ?? null;
}

function earnLine(group: ResolvedGroup, plan: ResolvedPlan, t: Translator, done: boolean) {
  const currency = bankedCurrency(group, plan);
  const farms = shopCurrency(plan, currency);
  const single = group.rows.length === 1 ? rowCount(group.rows[0]) : null;
  const count = farmCount(group, plan, farms);
  const parts = group.rows.filter((row) => row.label !== currency).map((row) => rowPart(row));
  return line(group, {
    id: group.id,
    kind: "earn",
    section: "farm",
    title: currency
      ? t("nextUp.stepEarn", { currency })
      : capitalized(group.activity ?? placeName(group.place)),
    count: shown(count),
    parts: parts.length > 1 || !single ? parts : [],
    picker: farms !== null,
    farms,
    done: farms ? farmDone(group, farms, count) : done || paidOff(group, plan) || covered(count),
    drawer: drawer(group, currency ?? plan.name),
  });
}

/** A sequence step reads as its action, with its pickups held in the drawer. */
function dropLine(group: ResolvedGroup, plan: ResolvedPlan, done: boolean): PlanLine {
  const farms = shopCurrency(plan, bankedCurrency(group, plan));
  const count = farmCount(group, plan, farms);
  const parts = group.rows
    .filter((row) => row.label !== farms)
    .map((row) => rowPart(row, shortLabel(row.label, plan.name)));
  const title = plan.sequence ? (group.activity ?? group.sub) : (group.sub ?? group.activity);
  return line(group, {
    id: group.id,
    kind: "drop",
    section: "farm",
    title: capitalized(title ?? placeName(group.place)),
    count: shown(count),
    parts: plan.sequence ? [] : parts,
    picker: farms !== null,
    farms,
    done: farms ? farmDone(group, farms, count) : done,
    drawer: drawer(group, plan.name, { parts: plan.sequence ? parts : [] }),
  });
}

/** A group the player covered another way is done and has nothing to tick. */
function groupLines(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  t: Translator,
  commons: Set<string>,
): PlanLine[] {
  const lines = openGroupLines(group, plan, t, commons);
  return group.skip === null ? lines : lines.map((entry) => ({ ...entry, rowIds: [] }));
}

function openGroupLines(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  t: Translator,
  commons: Set<string>,
): PlanLine[] {
  const done = group.done || group.skip !== null;
  if (isMaterialGroup(group)) return materialLines(group, plan, t, commons);
  const build = group.type === "foundry" || group.type === "craft";
  if (isPartSet(group)) {
    return [partSetLine(group, plan, t, done)];
  }
  if (build) return buildLines(group, t, done);
  if (group.type === "vendor") return buyLines(group, plan, t, done);
  if (group.type === "currency") return [earnLine(group, plan, t, done)];
  if (DROP_TYPES.has(group.type)) return [dropLine(group, plan, done)];
  const title =
    group.type === "gate"
      ? group.rows.map((row) => row.label).join(", ")
      : capitalized(group.activity ?? placeName(group.place));
  const wiki = group.type === "gate" ? (group.rows[0]?.label ?? plan.name) : plan.name;
  return [
    line(group, {
      id: group.id,
      kind: group.type === "gate" ? "quest" : "buy",
      section: "get",
      title,
      done,
      drawer: drawer(group, wiki),
    }),
  ];
}

/** "114 Kullervo's Bane short 100": one currency's need, then whether the
 *  balance covers it, unless the balance is unread. */
function totalText(line: ShopTotal, t: Translator): string {
  const need =
    line.currency === null
      ? t("nextUp.pickEither", { amount: formatNumber(line.need) })
      : priceText(line.currency, line.need, t);
  if (line.short === null) return need;
  const status =
    line.short === 0
      ? t("nextUp.pickCovered")
      : t("nextUp.pickShort", { amount: formatNumber(line.short) });
  return `${need} ${status}`;
}

/** What the plan's picks and crafting take, currency by currency. */
function shopCost(shop: ResolvedShop, t: Translator): string | null {
  const parts = shop.own.totals.filter((line) => line.need > 0).map((line) => totalText(line, t));
  return parts.length > 0 ? parts.join(" + ") : null;
}

/** Buying the plan's picks: open while any is left, held back until the
 *  balances cover them. */
function shopLine(shop: ResolvedShop, t: Translator): PlanLine {
  return {
    id: `shop:${shop.key}`,
    kind: "shop",
    section: "get",
    title: t("nextUp.stepBuyAt", { place: shop.vendor }),
    place: shop.place,
    cost: shopCost(shop, t),
    count: null,
    parts: [],
    chips: [],
    live: null,
    picker: true,
    farms: null,
    rowIds: [],
    done: shop.own.picks === 0,
    blocked: shop.own.covered === false,
    next: false,
    drawer: {
      where: `${shop.vendor}, ${shop.place}`,
      rates: [],
      notes: shop.notes,
      other: [],
      disclosures: [],
      tips: [],
      alts: [],
      parts: [],
      lead: false,
      map: null,
      wiki: buildWikiUrl(shop.vendor),
    },
  };
}

function basicsLine(chips: PlanLine[], t: Translator): PlanLine {
  return {
    ...chips[0],
    id: "basics",
    kind: "basics",
    title: t("nextUp.lineBasics"),
    place: "",
    cost: null,
    count: null,
    parts: [],
    chips,
    live: null,
    picker: false,
    farms: null,
    rowIds: chips.flatMap((chip) => chip.rowIds),
    done: chips.every((chip) => chip.done),
    blocked: false,
    drawer: {
      ...chips[0].drawer,
      where: null,
      rates: [],
      notes: [],
      other: [],
      alts: [],
      parts: [],
      lead: false,
    },
  };
}

/** A shop currency counts on one line: the first open one farming it. Another
 *  line farming it keeps only its pickups, and goes when it has none. */
function oneCountPerCurrency(lines: readonly PlanLine[]): PlanLine[] {
  const counted = new Map<string, PlanLine>();
  for (const entry of lines) {
    if (entry.farms === null) continue;
    const first = counted.get(entry.farms);
    if (!first || (first.done && !entry.done)) counted.set(entry.farms, entry);
  }
  return lines.flatMap((entry) => {
    if (entry.farms === null || counted.get(entry.farms) === entry) return [entry];
    return entry.parts.length > 0 ? [{ ...entry, count: null, farms: null }] : [];
  });
}

/** Two or more open farm lines at one place become a trip; one stays a line. */
function farmEntries(lines: readonly PlanLine[]): PlanEntry[] {
  const byPlace = new Map<string, PlanLine[]>();
  for (const entry of lines) {
    const key = entry.kind === "basics" ? "\u0000basics" : entry.place.toLowerCase();
    byPlace.set(key, [...(byPlace.get(key) ?? []), entry]);
  }
  return [...byPlace.values()].map(
    (group): PlanEntry =>
      group.length === 1
        ? group[0]
        : {
            kind: "trip",
            id: `trip:${group[0].id}`,
            place: group[0].place,
            lines: group,
            next: group.some((entry) => entry.next),
          },
  );
}

/** The plan as three sections, get, farm and build, in the order a player walks
 *  them. Done lines leave their section for the done list, and the first open
 *  line the player can act on is marked next. */
export function planSteps(plan: ResolvedPlan, options: StepOptions): PlanModel {
  const { t } = options;
  const commons = new Set<string>();
  const lines = oneCountPerCurrency(
    displayOrder(plan.groups).flatMap((group) => groupLines(group, plan, t, commons)),
  );
  if (plan.shop && plan.shop.ownWares > 0) lines.push(shopLine(plan.shop, t));
  const chips = lines.filter((entry) => commons.has(entry.id));
  const rest = lines.filter((entry) => !commons.has(entry.id));
  const ordered = SECTIONS.flatMap((section) => {
    const own = rest.filter((entry) => entry.section === section);
    return section === "farm" && chips.length > 0 ? [...own, basicsLine(chips, t)] : own;
  });
  if (ordered[0]) ordered[0].drawer.lead = true;
  const open = ordered.filter((entry) => !entry.done);
  const waiting = open.some((entry) => entry.section !== "build");
  for (const entry of open) if (entry.section === "build" && waiting) entry.blocked = true;
  const next = open.find((entry) => !entry.blocked) ?? open[0];
  if (next) next.next = true;
  const sections = SECTIONS.map((key) => {
    const own = open.filter((entry) => entry.section === key);
    return { key, entries: key === "farm" && !plan.sequence ? farmEntries(own) : own };
  }).filter((section) => section.entries.length > 0);
  return {
    sections,
    done: ordered.filter((entry) => entry.done),
    shop: plan.shop,
    copies: plan.copies,
  };
}

export type CopiesTag = "two" | "haveOne" | "subsumed" | "primeOwned";

/** How many copies a subsumable Warframe's plan builds, and why. */
export function copiesTag(plan: ResolvedPlan): CopiesTag | null {
  if (plan.kind !== "warframe" || !isSubsumableFrame(plan.name)) return null;
  const needs = plan.needs ?? [];
  if (plan.copies >= 2) return "two";
  if (needs.includes("mastery") && needs.includes("subsume")) return "primeOwned";
  if (needs.includes("subsume")) return "haveOne";
  return needs.includes("mastery") ? "subsumed" : null;
}

/** The step the player is on: the first open line, or the last once all are done. */
export function stepProgress(model: PlanModel): { step: number; total: number } {
  const open = model.sections.reduce(
    (sum, section) =>
      sum +
      section.entries.reduce(
        (count, entry) => count + (entry.kind === "trip" ? entry.lines.length : 1),
        0,
      ),
    0,
  );
  const total = open + model.done.length;
  return { step: open > 0 ? model.done.length + 1 : total, total };
}
