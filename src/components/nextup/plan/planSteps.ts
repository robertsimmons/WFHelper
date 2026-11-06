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
import { isCredits } from "../../../lib/suggest/acquisition/plan/resources.js";
import type { PlanDisclosure } from "../../../lib/suggest/acquisition/plan/schema.js";
import {
  isPartSet,
  setGoods,
  setTitle,
  type SetGoods,
} from "../../../lib/suggest/acquisition/plan/setTitle.js";
import type {
  ResolvedCraft,
  ResolvedOwed,
  ResolvedQuest,
  ResolvedSpend,
} from "../../../lib/suggest/acquisition/plan/types.js";
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
  /** What the line shows beside its title for where it happens. */
  tag: string;
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

const DROP_TYPES = new Set(["farm", "bounty", "boss", "relics", "fissure"]);
const SECTIONS: readonly PlanSectionKey[] = ["get", "farm", "build"];

const isMaterialGroup = (group: ResolvedGroup): boolean => group.id.startsWith("m");

const MINOR_WORDS = new Set(["of", "the", "and", "a", "an", "in", "on", "at", "to", "for"]);

/** "PLAINS OF EIDOLON, EARTH" reads as "Plains of Eidolon, Earth": each comma-separated
 *  name title-cased, a minor word lowercase past its first word; a token carrying a digit is a code. */
function placeName(place: string): string {
  return place
    .split(",")
    .map((name) =>
      name
        .split(/(\s+)/)
        .map((word, index, words) => {
          if (/\d/.test(word) || word.trim() === "") return word;
          const lower = word.toLowerCase();
          const first = words.slice(0, index).every((before) => before.trim() === "");
          return !first && MINOR_WORDS.has(lower)
            ? lower
            : word.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(""),
    )
    .join(",");
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "50K Cephalon Simaris Standing": a price names what pays it. */
function priceText(currency: string, value: number): string {
  return `${formatNumber(value)} ${currency}`;
}

function spendsText(spends: readonly (ResolvedSpend | ResolvedOwed)[]): string | null {
  const shown = spends.filter((spend) => !isCredits(spend.currency));
  if (shown.length === 0) return null;
  return shown.map((spend) => priceText(spend.currency, spend.value)).join(", ");
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
 *  own flow while the plan still owes it, or its one row. */
function farmCount(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  farms: string | null,
): PlanCount | null {
  if (farms && plan.shop) return shopCount(plan.shop, farms);
  const earns = group.earns;
  if (earns) return paidOff(group, plan) ? null : { have: earns.held ?? null, need: earns.value };
  return group.rows.length === 1 ? rowCount(group.rows[0]) : null;
}

const owedIn = (owes: readonly ResolvedOwed[] | undefined, ledger: string): number =>
  (owes ?? []).filter((owed) => owed.currency === ledger).reduce((sum, owed) => sum + owed.value, 0);

function spendPart(id: string, label: string, value: number, done: boolean): PlanPart {
  return { id, label, done, note: null, cost: null, count: done ? null : { have: null, need: value } };
}

/** What a banked currency pays for: one row per debt the plan counts in it, so the
 *  open rows add up to the line's count. */
function spendParts(plan: ResolvedPlan, ledger: string, t: Translator): PlanPart[] {
  return plan.groups.flatMap((group) => {
    const rows = group.rows.flatMap((row) => {
      const value = owedIn(row.owes, ledger);
      const label =
        row.craft && row.purchase?.blueprint
          ? t("nextUp.partBlueprint", { name: row.label })
          : row.label;
      return value > 0 ? [spendPart(row.id, label, value, group.done || row.done)] : [];
    });
    const own = owedIn(group.owes, ledger);
    const goods = group.rows.map((row) => row.label).join(", ");
    return own > 0 ? [spendPart(group.id, goods, own, group.done), ...rows] : rows;
  });
}

/** A line banking its group's flow lists what the currency pays for in place of the
 *  rows authored as figures in it, whose notes stay in the drawer. */
function earnDrawer(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  rows: readonly ResolvedRow[],
  pickups: readonly ResolvedRow[],
  t: Translator,
): Partial<PlanDrawer> {
  const ledger = group.earns?.ledger ?? group.earns?.currency ?? "";
  const figures = rows.filter((row) => !pickups.includes(row) && row.note);
  return {
    parts: [...spendParts(plan, ledger, t), ...drawerParts(pickups)],
    notes: [
      ...figures.map((row) => `${row.label}: ${row.note}`),
      ...group.conditions,
      ...group.bonuses,
    ],
  };
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
  return group.rows.every((row) => row.done || row.task || row.label === farms) && covered(count);
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
  const place = fields.place ?? placeName(group.place);
  return {
    place,
    tag: place,
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
    return row.pick.state === "spent" ? spendsText(row.pick.spends) : t("nextUp.planPickReward");
  }
  const price = row.purchase?.price ?? [];
  if (price.length > 0) {
    const text = spendsText(price);
    const units = row.qty?.required ?? 1;
    return text && row.purchase?.each && units > 1 ? t("nextUp.stepEach", { price: text }) : text;
  }
  if (row.owes?.length) return spendsText(row.owes);
  return group.rows.length === 1 && group.spends.length > 0 ? spendsText(group.spends) : null;
}

/** A material farms in Farm, and a shop currency counts the plan's whole need of it. */
function farmMaterialLine(
  group: ResolvedGroup,
  row: ResolvedRow,
  plan: ResolvedPlan,
  t: Translator,
): PlanLine {
  const farms = shopCurrency(plan, row.label);
  const count = farms && plan.shop ? shopCount(plan.shop, farms) : rowCount(row);
  const fields = {
    id: row.id,
    count,
    cost: row.purchase ? rowCost(row, group, t) : null,
    farms,
    rowIds: [row.id],
    done: farms ? covered(count) : row.done,
    drawer: { notes: rowNotes(row, group), other: row.other ?? [] },
  };
  if (row.currency) return earnLineOf(group, t, { ...fields, currency: row.label, parts: [] });
  return line(group, {
    ...fields,
    kind: "material",
    section: "farm",
    title: row.label,
    count: shown(count),
    picker: farms !== null,
    drawer: drawer(group, row.label, fields.drawer),
  });
}

interface EarnFields {
  id: string;
  currency: string;
  count: PlanCount | null;
  cost: string | null;
  farms: string | null;
  rowIds: string[];
  parts: PlanPart[];
  done: boolean;
  drawer: Partial<PlanDrawer>;
}

/** "Earn ..." or "farm Kuva" only says to earn the currency, which the title already does. */
function restates(activity: string, currency: string): boolean {
  const [verb, ...rest] = activity.toLowerCase().split(/\s+/);
  return verb === "earn" || rest.join(" ") === currency.toLowerCase();
}

/** "Kuva Flood, Kuva Flood Node": how a currency banks, then where. */
function earnTag(group: ResolvedGroup, currency: string): string {
  const activity =
    group.activity && !restates(group.activity, currency) ? capitalized(group.activity) : null;
  return [activity, placeName(group.place)].filter(Boolean).join(", ");
}

/** Every "Earn X" line, authored or drawn from the store, reads one way. */
function earnLineOf(group: ResolvedGroup, t: Translator, fields: EarnFields): PlanLine {
  const { currency, ...rest } = fields;
  return line(group, {
    ...rest,
    kind: "earn",
    section: "farm",
    title: t("nextUp.stepEarn", { currency }),
    tag: earnTag(group, currency),
    count: shown(rest.count),
    picker: rest.farms !== null,
    drawer: drawer(group, currency, rest.drawer),
  });
}

const CRAFT_STEP = { refine: "nextUp.stepRefine", build: "nextUp.stepBuild" } as const;

/** Getting a crafted material's blueprint in Get: bought, got where the store says
 *  it drops (one per craft unless reusable), or nothing where the plan buys it by
 *  hand. Done once held or no longer needed. */
function blueprintLine(
  group: ResolvedGroup,
  row: ResolvedRow,
  craft: ResolvedCraft,
  t: Translator,
): PlanLine | null {
  const purchase = row.purchase;
  const fields = { id: `${row.id}:bp`, rowIds: [], live: null, drawer: drawer(group, row.label) };
  const need = craft.blueprints?.need ?? 1;
  if (purchase?.blueprint) {
    const price = spendsText(purchase.price);
    return line(group, {
      ...fields,
      kind: "buy",
      section: "get",
      title: t(need > 1 ? "nextUp.lineBuyBlueprints" : "nextUp.lineBuyBlueprint", {
        name: row.label,
      }),
      cost: price && need > 1 ? t("nextUp.stepEach", { price }) : price,
      count: need > 1 ? { have: null, need } : null,
      done: purchase.owned || row.done,
      blocked: purchase.rankMet === false,
    });
  }
  if (!craft.blueprints) return null;
  const { held } = craft.blueprints;
  const count = { have: held === null ? null : Math.min(held, need), need };
  return line(group, {
    ...fields,
    kind: "buy",
    section: "get",
    title: t(need > 1 ? "nextUp.lineGetBlueprints" : "nextUp.lineGetBlueprint", {
      name: row.label,
    }),
    count: need > 1 ? count : null,
    done: row.done || covered(count),
  });
}

/** A crafted material is made in Build from parts its own rows farm, after its
 *  blueprint is got. */
function craftLines(
  group: ResolvedGroup,
  row: ResolvedRow,
  craft: ResolvedCraft,
  t: Translator,
): PlanLine[] {
  const make = line(group, {
    id: row.id,
    kind: "build",
    section: "build",
    title: t(CRAFT_STEP[craft.verb], { name: row.label }),
    place: t("common.foundry"),
    count: shown(rowCount(row)),
    rowIds: [row.id],
    done: row.done,
    drawer: drawer(group, row.label, {
      where: null,
      rates: group.meta ? [group.meta] : [],
      notes: rowNotes(row, group),
      map: null,
    }),
  });
  const blueprint = row.quest ? null : blueprintLine(group, row, craft, t);
  return blueprint ? [blueprint, make] : [make];
}

/** A material the store prices at a vendor is bought, not farmed: a tool or a unit
 *  paid in a currency. A currency itself is earned. */
const isBoughtMaterial = (row: ResolvedRow, plan: ResolvedPlan): boolean =>
  (row.purchase?.price.length ?? 0) > 0 && !row.currency && !shopCurrency(plan, row.label);

/** A material a quest hands over is got on that quest's step, so it has no line of its own. */
function materialLines(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  t: Translator,
  commons: Set<string>,
): PlanLine[] {
  return group.rows.flatMap((row) => {
    if (isCredits(row.label)) return [];
    if (row.craft) return craftLines(group, row, row.craft, t);
    if (row.quest) return [];
    if (isBoughtMaterial(row, plan)) return buyLines(group, [row], plan, t, false);
    if (row.common) commons.add(row.id);
    return [farmMaterialLine(group, row, plan, t)];
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
    const unit = unitCount(row);
    const times = row.purchase?.each ? unit.need - (unit.have ?? 0) : 1;
    for (const spend of row.purchase?.price ?? []) {
      totals.set(spend.currency, (totals.get(spend.currency) ?? 0) + spend.value * times);
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

const GOODS = {
  rankUps: "nextUp.goodsRankUps",
  blueprints: "nextUp.goodsBlueprints",
  parts: "nextUp.goodsParts",
} as const;

/** "Buy Necraloid rank-ups + Cortege blueprints": a buy step names what it buys;
 *  its vendor shows in the tag and drawer. */
function buyGoodsTitle(goods: readonly SetGoods[], t: Translator): string {
  const name = goods.map((entry) => t(GOODS[entry.kind], { name: entry.name })).join(" + ");
  return t("nextUp.lineBuy", { name });
}

const syndicateKey = (name: string): string =>
  name
    .trim()
    .replace(/\s+standing$/i, "")
    .replace(/^the\s+/i, "")
    .toLowerCase();

/** A rank-up is paid in its own syndicate's standing, or not priced at all; any
 *  other ranked row is an item a rank-up consumes. */
function isRankUp(row: ResolvedRow): boolean {
  if (!row.rank || row.paidAt) return false;
  const syndicate = syndicateKey(row.rank.syndicate);
  const price = row.purchase?.price ?? [];
  return price.length === 0 || price.some((spend) => syndicateKey(spend.currency) === syndicate);
}

function partSetTitle(group: ResolvedGroup, itemName: string, t: Translator): string {
  const rows = group.rows.map((row) => ({
    label: row.label,
    blueprint: row.purchase?.blueprint ?? false,
    rankUp: isRankUp(row) ? (row.rank?.syndicate ?? null) : null,
    sacrifice: Boolean(row.rank) && !isRankUp(row),
  }));
  const title = setTitle({ ...group, rows }, itemName);
  switch (title.kind) {
    case "titled":
      return title.vendor === null
        ? title.title
        : t("nextUp.setAt", { title: title.title, vendor: placeName(title.vendor) });
    case "buy":
      return buyGoodsTitle(title.goods, t);
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
  const sharedText = shared ? spendsText(shared) : null;
  const open = group.rows.filter((row) => !row.done);
  return line(group, {
    id: group.id,
    kind: build ? "build" : "buy",
    section: build ? "build" : "get",
    title: partSetTitle(group, plan.name, t),
    cost: shared
      ? sharedText && t("nextUp.stepEach", { price: sharedText })
      : spendsText(openTotal(group.rows)),
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

function buyLines(
  group: ResolvedGroup,
  rows: readonly ResolvedRow[],
  plan: ResolvedPlan,
  t: Translator,
  done: boolean,
) {
  return rows.map((row) => {
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
      drawer: drawer(group, isMaterialGroup(group) ? row.label : plan.name, {
        notes: rowNotes(row, group),
        other: row.other ?? [],
      }),
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

/** The currency a banking group pays into: its own, a shop currency a row names,
 *  or on a currency group with no figure, the currency a row names. */
function bankedCurrency(group: ResolvedGroup, plan: ResolvedPlan): string | null {
  if (group.earns) return group.earns.ledger ?? group.earns.currency;
  const sold = group.rows.find((row) => shopCurrency(plan, row.label))?.label;
  const named = group.type === "currency" ? group.rows.find((row) => row.currency)?.label : null;
  return sold ?? named ?? null;
}

/** The rows a currency group's own currency buys, each its own buy step. */
const boughtRows = (group: ResolvedGroup): ResolvedRow[] =>
  group.rows.filter((row) => group.buys?.includes(row.id));

const labelKey = (label: string): string => label.trim().toLowerCase();

/** A row naming the currency its line counts restates the line's count. */
const isCurrencyRow = (row: ResolvedRow, currency: string | null): boolean =>
  labelKey(row.label) === labelKey(currency ?? "");

/** A thing the player picks up on the trip: no currency, purchase, rank, or item
 *  a rank-up sacrifices. */
const isPickup = (row: ResolvedRow): boolean =>
  !row.currency && !row.purchase && !row.rank && !row.paidAt;

/** A drop is picked up on the trip even when a rank-up sacrifices it. */
const isDrop = (row: ResolvedRow): boolean =>
  !row.currency && !row.purchase && (!row.rank || Boolean(row.paidAt));

/** What the plan buys: a priced row, or any row of a vendor. */
function boughtLabels(plan: ResolvedPlan): Set<string> {
  const rows = plan.groups.flatMap((group) =>
    group.rows.filter((row) => row.purchase || group.type === "vendor"),
  );
  return new Set(rows.map((row) => labelKey(row.label)));
}

/** What a currency's rows hold beyond the currency itself: a task names no item,
 *  and a row the plan buys elsewhere is what the currency pays for. */
function earnPickups(plan: ResolvedPlan, rows: readonly ResolvedRow[], currency: string | null) {
  const bought = boughtLabels(plan);
  return rows.filter(
    (row) => !row.task && !bought.has(labelKey(row.label)) && !isCurrencyRow(row, currency),
  );
}

/** A line's pickups, one chip per thing: none repeats the title or another chip. */
function pickupParts(
  rows: readonly ResolvedRow[],
  title: string,
  picked: (row: ResolvedRow) => boolean,
  label: (row: ResolvedRow) => string,
) {
  const seen = new Set([labelKey(title)]);
  const parts: PlanPart[] = [];
  for (const row of rows.filter(picked)) {
    const key = labelKey(label(row));
    const first = parts.find((part) => labelKey(part.label) === key);
    if (first) first.done &&= row.done;
    else if (!seen.has(key)) parts.push(rowPart(row, label(row)));
    seen.add(key);
  }
  return parts;
}

/** The rows a line stands for, in its drawer: every row, chipped or not, with its
 *  note, count and price; a row paid at a rank-up is named on the rank-up. */
function drawerParts(rows: readonly ResolvedRow[]): PlanPart[] {
  return rows
    .filter((row) => !row.paidAt)
    .map((row) => ({
      ...rowPart(row),
      cost: row.purchase?.price.length ? spendsText(row.purchase.price) : null,
      count: rowCount(row),
    }));
}

function earnLine(group: ResolvedGroup, plan: ResolvedPlan, t: Translator, done: boolean) {
  const currency = bankedCurrency(group, plan);
  const farms = shopCurrency(plan, currency);
  const rows = group.rows.filter((row) => !group.buys?.includes(row.id));
  const count = farmCount(group, plan, farms);
  const title = currency
    ? t("nextUp.stepEarn", { currency })
    : capitalized(group.activity ?? placeName(group.place));
  const counted = !group.earns && !farms && rows.length === 1 && rowCount(rows[0]) !== null;
  const picks = counted
    ? []
    : pickupParts(earnPickups(plan, rows, currency), title, isPickup, (row) => row.label);
  const fields = {
    id: group.id,
    count,
    cost: null,
    parts: picks,
    farms,
    rowIds: rows.map((row) => row.id),
    done: farms ? farmDone(group, farms, count) : done || paidOff(group, plan) || covered(count),
    drawer:
      group.earns && !farms
        ? earnDrawer(group, plan, rows, earnPickups(plan, rows, currency).filter(isPickup), t)
        : {
            parts: counted ? [] : drawerParts(rows.filter((row) => !isCurrencyRow(row, currency))),
            notes: [
              ...rows.flatMap((row) => (isCurrencyRow(row, currency) && row.note ? [row.note] : [])),
              ...group.conditions,
              ...group.bonuses,
            ],
          },
  };
  if (currency) return earnLineOf(group, t, { ...fields, currency });
  return line(group, {
    ...fields,
    kind: "earn",
    section: "farm",
    title,
    count: shown(count),
    picker: farms !== null,
    drawer: drawer(group, plan.name, fields.drawer),
  });
}

/** A sequence step reads as its action, with its pickups held in the drawer. A
 *  row it buys is its own buy step. */
function dropLine(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  t: Translator,
  done: boolean,
): PlanLine {
  const farms = shopCurrency(plan, bankedCurrency(group, plan));
  const count = farmCount(group, plan, farms);
  const title = capitalized(
    (plan.sequence ? (group.activity ?? group.sub) : (group.sub ?? group.activity)) ??
      placeName(group.place),
  );
  const rows = group.rows.filter((row) => row.label !== farms && !row.purchase);
  const short = (row: ResolvedRow): string => shortLabel(row.label, plan.name);
  const picks = pickupParts(rows, title, isDrop, short);
  const steps = rows.filter((row) => !row.paidAt).map((row) => rowPart(row, short(row)));
  const banks = group.earns !== null && !farms;
  const banked = (): boolean =>
    rows.every((row) => row.done || row.task || !isDrop(row)) && (count === null || covered(count));
  return line(group, {
    id: group.id,
    kind: "drop",
    section: "farm",
    title,
    count: shown(count),
    parts: plan.sequence ? [] : picks,
    picker: farms !== null,
    farms,
    rowIds: group.rows.filter((row) => !row.purchase).map((row) => row.id),
    done: farms ? farmDone(group, farms, count) : done || (banks && banked()),
    drawer: drawer(
      group,
      plan.name,
      plan.sequence
        ? { parts: steps }
        : banks
          ? earnDrawer(group, plan, rows, rows.filter(isDrop), t)
          : { parts: drawerParts(rows) },
    ),
  });
}

/** Every drop group a quest pays out from, in plan order. */
function questGroups(plan: ResolvedPlan, quest: string): ResolvedGroup[] {
  const key = questKey(quest);
  return plan.groups.filter(
    (group) => group.quest && DROP_TYPES.has(group.type) && questKey(group.quest) === key,
  );
}

/** Where a further group of a quest step happens and how, as one drawer note. */
function groupNote(group: ResolvedGroup, wiki: string): string {
  const { where, rates } = drawer(group, wiki);
  return [where, ...rates].filter(Boolean).join(" | ");
}

/** Every group a quest pays out from is that quest's one step in Get, its pickups
 *  named in full; the drawer holds each group's place and every row. Done once the
 *  quest is, or once every pickup is held. */
function questStepLine(groups: readonly ResolvedGroup[], quest: string, t: Translator): PlanLine {
  const [host, ...rest] = groups;
  const title = t("nextUp.stepDoQuest", { quest });
  const rows = groups.flatMap((group) => group.rows.filter((row) => !row.purchase));
  const parts = pickupParts(rows, title, isDrop, (row) => row.label);
  const finished = groups.every((group) => group.done || group.skip !== null);
  const base = drawer(host, quest);
  return line(host, {
    id: host.id,
    kind: "quest",
    section: "get",
    title,
    parts,
    rowIds: rows.map((row) => row.id),
    done: finished || (parts.length > 0 && parts.every((part) => part.done)),
    drawer: {
      ...base,
      notes: [
        ...base.notes,
        ...rest.flatMap((group) => [groupNote(group, quest), ...group.conditions, ...group.bonuses]),
      ],
      disclosures: groups.flatMap((group) => group.disclosures),
      tips: groups.flatMap((group) => group.tips),
      map: base.map ?? drawer(rest.find((group) => group.map) ?? host, quest).map,
      parts: drawerParts(rows),
    },
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
  if (group.type === "vendor") return buyLines(group, group.rows, plan, t, done);
  if (group.type === "currency") {
    return [earnLine(group, plan, t, done), ...buyLines(group, boughtRows(group), plan, t, done)];
  }
  if (DROP_TYPES.has(group.type)) {
    const bought = group.rows.filter((row) => row.purchase);
    const host = group.quest ? questGroup(plan, group.quest) : undefined;
    const buys = buyLines(group, bought, plan, t, done);
    if (!group.quest || !host || !DROP_TYPES.has(host.type)) {
      return [dropLine(group, plan, t, done), ...buys];
    }
    if (host !== group) return buys;
    return [questStepLine(questGroups(plan, group.quest), group.quest, t), ...buys];
  }
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
      : priceText(line.currency, line.need);
  if (line.short === null) return need;
  const status =
    line.short === 0
      ? t("nextUp.pickCovered")
      : t("nextUp.pickShort", { amount: formatNumber(line.short) });
  return `${need} ${status}`;
}

/** What the plan's picks and crafting take, currency by currency. */
function shopCost(shop: ResolvedShop, t: Translator): string | null {
  const parts = shop.own.totals
    .filter((line) => line.need > 0 && !(line.currency && isCredits(line.currency)))
    .map((line) => totalText(line, t));
  return parts.length > 0 ? parts.join(" + ") : null;
}

/** A drawer with only a wiki link and what the caller adds. */
function bareDrawer(wiki: string, extra: Partial<PlanDrawer> = {}): PlanDrawer {
  return {
    where: null,
    rates: [],
    notes: [],
    other: [],
    disclosures: [],
    tips: [],
    alts: [],
    parts: [],
    lead: false,
    map: null,
    wiki,
    ...extra,
  };
}

/** Buying the plan's picks: open while any is left, held back until the
 *  balances cover them. */
function shopLine(shop: ResolvedShop, itemName: string, t: Translator): PlanLine {
  const [ware, ...more] = shop.ownNames;
  const goods = setGoods(
    shop.ownNames.map((label) => ({ label, blueprint: false })),
    itemName,
  );
  return {
    id: `shop:${shop.key}`,
    kind: "shop",
    section: "get",
    title: more.length === 0 ? t("nextUp.lineBuy", { name: ware }) : buyGoodsTitle(goods, t),
    place: shop.place,
    tag: shop.place,
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
    drawer: bareDrawer(buildWikiUrl(shop.vendor), {
      where: `${shop.vendor}, ${shop.place}`,
      notes: shop.notes,
    }),
  };
}

function basicsLine(chips: PlanLine[], t: Translator): PlanLine {
  return {
    ...chips[0],
    id: "basics",
    kind: "basics",
    title: t("nextUp.lineBasics"),
    place: "",
    tag: "",
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

/** "2 Gallium, 30K Credits": a sacrificed item and what of its price the rank-up's
 *  own price does not already say. */
function sacrificeText(row: ResolvedRow, rankUp: ResolvedRow): string {
  const own = new Set((rankUp.purchase?.price ?? []).map((spend) => spend.currency));
  const price = (row.purchase?.price ?? []).filter((spend) => !own.has(spend.currency));
  const item = row.qty ? `${formatNumber(row.qty.required)} ${row.label}` : row.label;
  const text = spendsText(price);
  return [item, ...(text ? [text] : [])].join(", ");
}

/** A rank-up row's note carries the items it sacrifices, which the plan lists
 *  elsewhere; those rows then appear nowhere else. */
function withSacrifices(plan: ResolvedPlan): ResolvedPlan {
  const rows = plan.groups.flatMap((group) => group.rows);
  const paid = new Map<string, string[]>();
  for (const row of rows) {
    const rankUp = row.paidAt ? rows.find((entry) => entry.id === row.paidAt) : undefined;
    if (rankUp) paid.set(rankUp.id, [...(paid.get(rankUp.id) ?? []), sacrificeText(row, rankUp)]);
  }
  if (paid.size === 0) return plan;
  const noted = (row: ResolvedRow): ResolvedRow => {
    const items = paid.get(row.id);
    if (!items) return row;
    return { ...row, note: [row.note, items.join("; ")].filter(Boolean).join("; ") };
  };
  return {
    ...plan,
    groups: plan.groups.map((group) => ({ ...group, rows: group.rows.map(noted) })),
  };
}

const questKey = (name: string): string =>
  labelKey(name)
    .replace(/^the /, "")
    .replace(/ quest$/, "");

/** What a quest hands over for a material: its blueprint when crafted, else the material. */
function questPart(row: ResolvedRow, t: Translator): PlanPart {
  if (!row.craft) return rowPart(row);
  const need = row.craft.blueprints?.need ?? 1;
  const held = row.craft.blueprints?.held ?? null;
  const count = { have: held === null ? null : Math.min(held, need), need };
  return {
    ...rowPart(row, t("nextUp.partBlueprint", { name: row.label })),
    id: `${row.id}:bp`,
    done: row.done || covered(count),
    count: need > 1 ? count : null,
  };
}

/** The plan's own step for a quest: the first drop paying out from it, or a gate naming it. */
function questGroup(plan: ResolvedPlan, quest: string): ResolvedGroup | undefined {
  const key = questKey(quest);
  return plan.groups.find(
    (group) =>
      (group.quest && DROP_TYPES.has(group.type) && questKey(group.quest) === key) ||
      (group.type === "gate" && group.rows.some((row) => questKey(row.label) === key)),
  );
}

function questLine(quest: ResolvedQuest, parts: PlanPart[], t: Translator): PlanLine {
  return {
    id: `quest:${questKey(quest.name)}`,
    kind: "quest",
    section: "get",
    title: t("nextUp.stepDoQuest", { quest: quest.name }),
    place: "",
    tag: "",
    cost: null,
    count: null,
    parts,
    chips: [],
    live: null,
    picker: false,
    farms: null,
    rowIds: [],
    done: quest.done === true || parts.every((part) => part.done),
    blocked: false,
    next: false,
    drawer: bareDrawer(buildWikiUrl(quest.name), { parts }),
  };
}

/** Everything one quest hands over is picked up on one step: the plan's own step
 *  for that quest, else "Do <quest>" leading Get. */
function withQuestPickups(lines: PlanLine[], plan: ResolvedPlan, t: Translator): PlanLine[] {
  const byQuest = new Map<string, { quest: ResolvedQuest; parts: PlanPart[] }>();
  for (const row of plan.groups.flatMap((group) => group.rows)) {
    if (!row.quest) continue;
    const key = questKey(row.quest.name);
    const entry = byQuest.get(key) ?? { quest: row.quest, parts: [] };
    entry.parts.push(questPart(row, t));
    byQuest.set(key, entry);
  }
  const out = [...lines];
  for (const { quest, parts } of byQuest.values()) {
    const group = questGroup(plan, quest.name);
    const at = group ? out.findIndex((entry) => entry.id === group.id) : -1;
    if (at === -1) {
      out.unshift(questLine(quest, parts, t));
      continue;
    }
    const host = out[at];
    const shown = new Set([host.title, ...host.parts.map((part) => part.label)].map(labelKey));
    const added = parts.filter((part) => !shown.has(labelKey(part.label)));
    const got = quest.done === true || added.every((part) => part.done);
    out[at] = {
      ...host,
      parts: [...host.parts, ...added],
      done: host.done && got,
      drawer: { ...host.drawer, parts: [...host.drawer.parts, ...added] },
    };
  }
  return out;
}

/** The plan as three sections, get, farm and build, in the order a player walks
 *  them. Done lines leave their section for the done list, and the first open
 *  line the player can act on is marked next. */
export function planSteps(resolved: ResolvedPlan, options: StepOptions): PlanModel {
  const { t } = options;
  const plan = withSacrifices(resolved);
  const commons = new Set<string>();
  const lines = withQuestPickups(
    oneCountPerCurrency(
      displayOrder(plan.groups).flatMap((group) => groupLines(group, plan, t, commons)),
    ),
    plan,
    t,
  );
  if (plan.shop && plan.shop.ownWares > 0) lines.push(shopLine(plan.shop, plan.name, t));
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
    shop: plan.shop?.picker ? plan.shop : null,
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
