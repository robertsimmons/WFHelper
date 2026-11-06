import { figuresIn, isCreditFigure, readPrices } from "./priceText.js";
import { rankSyndicate, rankTitle, topRank } from "./ranks.js";
import { resourceEntry, resourceLookup, type ResourceLookup } from "./resources.js";
import { isPartSet, setTitle, setTitleKey } from "./setTitle.js";
import { parseQuantity } from "./state.js";
import { shopFor } from "../shops/data.js";
import type { AuthoredShop } from "../shops/schema.js";
import {
  PLAN_BADGE_TONES,
  PLAN_GROUP_TYPES,
  PLAN_LIVE_STATES,
  PLAN_MAP_KEYS,
  PLAN_ROUTE_ROLES,
  PLAN_SOURCES,
  type PlanRank,
} from "./schema.js";

const GROUP_TYPES = new Set<string>(PLAN_GROUP_TYPES);
const MAP_KEYS = new Set<string>(PLAN_MAP_KEYS);
const MAPLESS_GROUP_TYPES = new Set(["vendor", "gate"]);
const ROUTE_ROLES = new Set<string>(PLAN_ROUTE_ROLES);
const SOURCES = new Set<string>(PLAN_SOURCES);
const LIVE_STATES = new Set<string>(PLAN_LIVE_STATES);
const BADGE_TONES = new Set<string>(PLAN_BADGE_TONES);
const QUANTITY = /^\d{1,3}(?:,\d{3})*$|^\d+$/;

type Problems = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkString(problems: Problems, at: string, value: unknown): void {
  if (typeof value !== "string" || value === "") problems.push(`${at} must be a non-empty string`);
}

function checkNullableString(problems: Problems, at: string, value: unknown): void {
  if (value === null) return;
  if (typeof value !== "string" || value === "") problems.push(`${at} must be a string or null`);
}

function checkMapKey(problems: Problems, at: string, value: unknown): void {
  if (value === null) return;
  if (typeof value !== "string" || !MAP_KEYS.has(value)) {
    problems.push(`${at} must be a map key or null`);
  }
}

function checkStringList(problems: Problems, at: string, value: unknown): void {
  if (!Array.isArray(value)) {
    problems.push(`${at} must be an array`);
    return;
  }
  value.forEach((entry, index) => checkString(problems, `${at}[${index}]`, entry));
}

function checkCurrency(problems: Problems, at: string, value: unknown): void {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return;
  }
  checkString(problems, `${at}.currency`, value.currency);
  if (typeof value.amount !== "string" || !QUANTITY.test(value.amount)) {
    problems.push(`${at}.amount must be a grouped number string`);
  }
}

function checkAlt(problems: Problems, at: string, value: unknown): void {
  if (value === null || typeof value === "string") {
    if (value === "") problems.push(`${at} must be a non-empty string or null`);
    return;
  }
  if (!isRecord(value)) {
    problems.push(`${at} must be a string, an offer object or null`);
    return;
  }
  checkString(problems, `${at}.text`, value.text);
  if (!Array.isArray(value.spends)) {
    problems.push(`${at}.spends must be an array`);
    return;
  }
  value.spends.forEach((spend, index) => checkCurrency(problems, `${at}.spends[${index}]`, spend));
}

/** A price or rank belongs in `buy`, `spends`, `rank` or `pick`, never in prose. A
 *  build line may still name its foundry credits. */
function checkProse(problems: Problems, at: string, value: unknown, credits: boolean): void {
  if (typeof value !== "string") return;
  const stray = figuresIn(value).filter((figure) => !(credits && isCreditFigure(figure)));
  // A clause that is a rank title and nothing else ("Doer") is a rank too.
  const read = readPrices(value, { standing: null, syndicate: null }, { keepCredits: credits });
  if (read.rank && stray.length === 0) stray.push(rankTitle(read.rank));
  if (stray.length > 0) {
    problems.push(`${at} writes "${stray.join('", "')}" as text; use the structured fields`);
  }
}

const PRICED = /(?:standing|platinum|plat|credits|cr)$/i;

/** The ranks a group's rows carry, as structure: reached, picked or required. */
function groupRanks(group: Record<string, unknown>): PlanRank[] {
  if (!Array.isArray(group.rows)) return [];
  return group.rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const pick = isRecord(row.pick) ? row.pick.rank : null;
    const buy = isRecord(row.buy) ? row.buy.rank : null;
    return [row.rank, pick, buy].filter(
      (rank): rank is PlanRank =>
        isRecord(rank) && typeof rank.syndicate === "string" && typeof rank.level === "number",
    );
  });
}

/** A step's action may name the rank it works toward, as long as a row carries that
 *  rank as structure; a price never belongs there. */
function checkActivity(problems: Problems, at: string, group: Record<string, unknown>): void {
  if (typeof group.activity !== "string") return;
  const ranks = groupRanks(group);
  const backed = (figure: string): boolean => {
    const level = /rank\s+(-?\d)/i.exec(figure);
    const text = figure.toLowerCase();
    return ranks.some((rank) =>
      level ? Number(level[1]) === rank.level : text.includes(rankTitle(rank).toLowerCase()),
    );
  };
  const stray = figuresIn(group.activity).filter(
    (figure) => PRICED.test(figure) || !backed(figure),
  );
  if (stray.length > 0) {
    problems.push(`${at} writes "${stray.join('", "')}" as text; use the structured fields`);
  }
}

function checkPurchase(problems: Problems, at: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    problems.push(`${at} must be an object or null`);
    return;
  }
  if (!Array.isArray(value.price)) {
    problems.push(`${at}.price must be an array`);
    return;
  }
  value.price.forEach((price, index) => checkCurrency(problems, `${at}.price[${index}]`, price));
  checkRank(problems, `${at}.rank`, value.rank);
  if (value.price.length === 0 && (value.rank === undefined || value.rank === null)) {
    problems.push(`${at} needs a price or a rank`);
  }
  for (const flag of ["reusable", "each", "blueprint"]) {
    if (value[flag] !== undefined && typeof value[flag] !== "boolean") {
      problems.push(`${at}.${flag} must be a boolean`);
    }
  }
}

function checkRow(problems: Problems, at: string, value: unknown, build = false): void {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return;
  }
  checkString(problems, `${at}.label`, value.label);
  checkNullableString(problems, `${at}.note`, value.note);
  checkProse(problems, `${at}.note`, value.note, build);
  checkPurchase(problems, `${at}.buy`, value.buy);
  if (value.qty !== null && (typeof value.qty !== "string" || !QUANTITY.test(value.qty))) {
    problems.push(`${at}.qty must be a grouped number string or null`);
  }
  checkAlt(problems, `${at}.alt`, value.alt);
  if (typeof value.done !== "boolean") problems.push(`${at}.done must be a boolean`);
  checkRank(problems, `${at}.rank`, value.rank);
  checkPick(problems, `${at}.pick`, value.pick);
  if (value.assembled !== undefined && typeof value.assembled !== "boolean") {
    problems.push(`${at}.assembled must be a boolean`);
  }
  if (value.task !== undefined && typeof value.task !== "boolean") {
    problems.push(`${at}.task must be a boolean`);
  }
}

function checkPick(problems: Problems, at: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    problems.push(`${at} must be an object or null`);
    return;
  }
  if (value.rank === undefined || value.rank === null) problems.push(`${at}.rank is required`);
  else checkRank(problems, `${at}.rank`, value.rank);
  if (!Array.isArray(value.spends) || value.spends.length === 0) {
    problems.push(`${at}.spends must be a non-empty array`);
    return;
  }
  value.spends.forEach((spend, index) => checkCurrency(problems, `${at}.spends[${index}]`, spend));
}

export function checkRank(problems: Problems, at: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    problems.push(`${at} must be an object or null`);
    return;
  }
  const meta = typeof value.syndicate === "string" ? rankSyndicate(value.syndicate) : null;
  if (!meta) {
    problems.push(`${at}.syndicate is not a syndicate in the rank table`);
    return;
  }
  const level = value.level;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > topRank(meta)) {
    problems.push(`${at}.level must be a whole number 1-${topRank(meta)}`);
  }
}

function checkBadges(problems: Problems, at: string, value: unknown): void {
  if (!Array.isArray(value)) {
    problems.push(`${at} must be an array`);
    return;
  }
  value.forEach((badge, index) => {
    if (!isRecord(badge)) {
      problems.push(`${at}[${index}] must be an object`);
      return;
    }
    checkString(problems, `${at}[${index}].text`, badge.text);
    if (typeof badge.tone !== "string" || !BADGE_TONES.has(badge.tone)) {
      problems.push(`${at}[${index}].tone is not a badge tone`);
    }
    checkRank(problems, `${at}[${index}].rank`, badge.rank);
  });
}

function checkEffort(problems: Problems, at: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    problems.push(`${at} must be a whole number`);
  } else if (value < 1 || value > 10) {
    problems.push(`${at} must be 1-10`);
  }
}

/** Group types a card can name as the route it leads with. */
const ROUTE_GROUP_TYPES = new Set(["farm", "bounty", "boss", "vendor", "relics", "fissure"]);

function checkAfterQuest(
  problems: Problems,
  value: Record<string, unknown>,
  itemName: string,
  lookup: ResourceLookup,
): void {
  const after = value.afterQuest;
  if (after === undefined || after === null) return;
  if (!isRecord(after)) {
    problems.push("afterQuest must be an object or null");
    return;
  }
  const groups = Array.isArray(value.groups) ? value.groups : [];
  if (!groups.some((group) => isRecord(group) && typeof group.quest === "string")) {
    problems.push("afterQuest needs a group with a quest");
  }
  checkEffort(problems, "afterQuest.effort", after.effort);
  checkBadges(problems, "afterQuest.badges", after.badges);
  if (!Array.isArray(after.groups) || after.groups.length === 0) {
    problems.push("afterQuest.groups must be a non-empty array");
    return;
  }
  after.groups.forEach((group, index) => {
    const at = `afterQuest.groups[${index}]`;
    checkGroup(problems, at, group, itemName, lookup);
    if (isRecord(group) && group.quest !== undefined && group.quest !== null) {
      problems.push(`${at}.quest must be absent: the quest is already done`);
    }
  });
  // A shop plan's purchases live in the shop, so banking its currency is the route.
  const routeTypes = value.shop ? new Set([...ROUTE_GROUP_TYPES, "currency"]) : ROUTE_GROUP_TYPES;
  if (!after.groups.some((group) => isRecord(group) && routeTypes.has(String(group.type)))) {
    problems.push("afterQuest.groups needs a farm, bounty, boss, vendor, relics or fissure group");
  }
}

/** Each route's effort is the rating the plan or its after-quest route carries,
 *  so the overview and the card never disagree. */
function checkRoutes(problems: Problems, value: Record<string, unknown>): void {
  const routes = value.routes;
  if (routes === undefined) return;
  if (!Array.isArray(routes) || routes.length === 0) {
    problems.push("routes must be a non-empty array");
    return;
  }
  const byRole = new Map<string, Record<string, unknown>[]>();
  routes.forEach((route, index) => {
    const at = `routes[${index}]`;
    if (!isRecord(route)) {
      problems.push(`${at} must be an object`);
      return;
    }
    checkString(problems, `${at}.name`, route.name);
    checkString(problems, `${at}.cost`, route.cost);
    checkEffort(problems, `${at}.effort`, route.effort);
    if (route.role === null) return;
    if (typeof route.role !== "string" || !ROUTE_ROLES.has(route.role)) {
      problems.push(`${at}.role must be chosen, afterQuest or null`);
      return;
    }
    byRole.set(route.role, [...(byRole.get(route.role) ?? []), route]);
  });
  const chosen = byRole.get("chosen") ?? [];
  if (chosen.length !== 1) problems.push("routes needs exactly one chosen route");
  else if (chosen[0].effort !== value.effort)
    problems.push("the chosen route's effort must match effort");
  const after = byRole.get("afterQuest") ?? [];
  const planAfter = isRecord(value.afterQuest) ? value.afterQuest : null;
  if (after.length > 1) problems.push("routes has more than one afterQuest route");
  if (after.length > 0 && !planAfter) problems.push("an afterQuest route needs afterQuest");
  if (planAfter && after.length === 0) problems.push("routes needs the afterQuest route");
  if (planAfter && after.length === 1 && after[0].effort !== planAfter.effort) {
    problems.push("the afterQuest route's effort must match afterQuest.effort");
  }
}

function checkDisclosure(problems: Problems, at: string, value: unknown): void {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return;
  }
  checkString(problems, `${at}.title`, value.title);
  checkString(problems, `${at}.body`, value.body);
}

/** Group types whose rows a curated store entry replaces. Currency groups keep
 *  theirs, since syndicate rank-up sacrifices are rows there. */
const MATERIAL_GROUP_TYPES = new Set(["farm", "bounty", "boss", "vendor", "foundry", "craft"]);

/** The item itself or one of its own parts, which stay rows even when the store
 *  happens to name them. */
function isOwnPart(label: string, itemName: string): boolean {
  const own = itemName.trim().toLowerCase();
  const name = label.trim().toLowerCase();
  return name === own || name.startsWith(`${own} `) || name.startsWith(`${own}'s `);
}

/** Simple plurals count: "Son Tokens" names the "Son Token" entry. */
function isCurated(label: string, lookup: ResourceLookup): boolean {
  const singular = [label, label.replace(/s$/i, ""), label.replace(/es$/i, "")];
  return singular.some((name) => name !== "" && Boolean(lookup(name)?.kind));
}

function flowCurrencies(value: Record<string, unknown>): [string, unknown][] {
  const flows: [string, unknown][] = [];
  if (isRecord(value.earns)) flows.push(["earns", value.earns.currency]);
  if (Array.isArray(value.spends)) {
    value.spends.forEach((spend, index) => {
      if (isRecord(spend)) flows.push([`spends[${index}]`, spend.currency]);
    });
  }
  if (!Array.isArray(value.rows)) return flows;
  value.rows.forEach((row, index) => {
    if (!isRecord(row)) return;
    if (isRecord(row.buy) && Array.isArray(row.buy.price)) {
      row.buy.price.forEach((price, at) => {
        if (isRecord(price)) flows.push([`rows[${index}].buy.price[${at}]`, price.currency]);
      });
    }
    for (const field of ["alt", "pick"]) {
      const offer = row[field];
      if (!isRecord(offer) || !Array.isArray(offer.spends)) continue;
      offer.spends.forEach((spend, at) => {
        if (isRecord(spend)) flows.push([`rows[${index}].${field}.spends[${at}]`, spend.currency]);
      });
    }
  });
  return flows;
}

function checkStoreRefs(
  problems: Problems,
  at: string,
  value: Record<string, unknown>,
  itemName: string,
  lookup: ResourceLookup,
): void {
  if (value.ref !== undefined) {
    checkNullableString(problems, `${at}.ref`, value.ref);
    if (typeof value.ref === "string" && value.ref !== "" && !lookup(value.ref)) {
      problems.push(`${at}.ref "${value.ref}" is not in the resource store`);
    }
  }
  if (value.type === "currency" && (typeof value.ref !== "string" || value.ref === "")) {
    problems.push(`${at}.ref must name the store entry for its currency`);
  }
  for (const [where, currency] of flowCurrencies(value)) {
    if (typeof currency !== "string" || currency === "") continue;
    const entry = lookup(currency);
    if (!entry) problems.push(`${at}.${where}.currency "${currency}" is not in the resource store`);
    else if (entry.spelled !== currency) {
      problems.push(`${at}.${where}.currency "${currency}" must be spelled "${entry.spelled}"`);
    }
  }
  if (typeof value.type !== "string" || !MATERIAL_GROUP_TYPES.has(value.type)) return;
  if (!Array.isArray(value.rows)) return;
  value.rows.forEach((row, index) => {
    if (!isRecord(row) || typeof row.label !== "string") return;
    if (isCurated(row.label, lookup) && !isOwnPart(row.label, itemName)) {
      problems.push(
        `${at}.rows[${index}] "${row.label}" is a curated resource; list it in materials`,
      );
    }
  });
}

function checkMaterial(
  problems: Problems,
  at: string,
  value: unknown,
  lookup: ResourceLookup,
): void {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return;
  }
  checkString(problems, `${at}.label`, value.label);
  checkNullableString(problems, `${at}.note`, value.note);
  if (typeof value.qty !== "string" || !QUANTITY.test(value.qty)) {
    problems.push(`${at}.qty must be a grouped number string`);
  }
  if (typeof value.label === "string" && value.label !== "" && !lookup(value.label)) {
    problems.push(`${at}.label "${value.label}" is not in the resource store`);
  }
}

/** A task priced in the currency its own group earns restates purchases the plan
 *  makes elsewhere, so the same buy shows twice. */
function checkLumpedSpend(problems: Problems, at: string, group: Record<string, unknown>): void {
  const earns = isRecord(group.earns) ? group.earns.currency : null;
  const own = [earns, group.ref].filter((name): name is string => typeof name === "string");
  if (group.type !== "currency" || own.length === 0 || !Array.isArray(group.rows)) return;
  group.rows.forEach((row, index) => {
    if (!isRecord(row) || row.task !== true || !isRecord(row.buy)) return;
    const price = Array.isArray(row.buy.price) ? row.buy.price : [];
    const lumped = price.some(
      (spend) =>
        isRecord(spend) && typeof spend.currency === "string" && own.includes(spend.currency),
    );
    if (lumped) {
      problems.push(
        `${at}.rows[${index}] is a task priced in the group's own currency; price the rows it buys instead`,
      );
    }
  });
}

/** A group's spend in one currency, summed over its bought rows: `each` rows per
 *  unit, and the rest per unit too when `perUnit` reads every price that way. */
function rowsSpend(
  rows: readonly Record<string, unknown>[],
  currency: string,
  ledger: (name: string) => string,
  perUnit: boolean,
): number {
  let sum = 0;
  for (const row of rows) {
    if (row.pick || !isRecord(row.buy) || !Array.isArray(row.buy.price)) continue;
    const price = row.buy.price.find(
      (entry) =>
        isRecord(entry) &&
        typeof entry.currency === "string" &&
        ledger(entry.currency) === currency,
    );
    if (!isRecord(price) || typeof price.amount !== "string") continue;
    const each = row.buy.each === true || (perUnit && row.buy.blueprint !== true);
    const qty = typeof row.qty === "string" ? row.qty : null;
    sum += parseQuantity(price.amount) * (each ? parseQuantity(qty) : 1);
  }
  return sum;
}

/** A per-unit price missing `each`: the group's spend matches its rows only once
 *  their prices are read per unit. */
function checkMissingEach(
  problems: Problems,
  at: string,
  group: Record<string, unknown>,
  lookup: ResourceLookup,
): void {
  if (!Array.isArray(group.spends) || !Array.isArray(group.rows)) return;
  const rows = group.rows.filter(isRecord);
  const ledger = (name: string): string => lookup(name)?.name ?? name;
  for (const spend of group.spends.filter(isRecord)) {
    if (typeof spend.currency !== "string" || typeof spend.amount !== "string") continue;
    const currency = ledger(spend.currency);
    const total = parseQuantity(spend.amount);
    const authored = rowsSpend(rows, currency, ledger, false);
    if (authored !== total && rowsSpend(rows, currency, ledger, true) === total) {
      problems.push(
        `${at} spends ${spend.amount} ${spend.currency} only if its rows' prices are per unit; mark them "each"`,
      );
    }
  }
}

function checkGroup(
  problems: Problems,
  at: string,
  value: unknown,
  itemName: string,
  lookup: ResourceLookup,
): void {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return;
  }
  if (typeof value.type !== "string" || !GROUP_TYPES.has(value.type)) {
    problems.push(`${at}.type is not a plan group type`);
  }
  checkString(problems, `${at}.place`, value.place);
  checkNullableString(problems, `${at}.sub`, value.sub);
  checkNullableString(problems, `${at}.activity`, value.activity);
  checkNullableString(problems, `${at}.meta`, value.meta);
  checkNullableString(problems, `${at}.mode`, value.mode);
  const build = value.type === "foundry" || value.type === "craft";
  checkActivity(problems, `${at}.activity`, value);
  checkProse(problems, `${at}.meta`, value.meta, build);
  checkMapKey(problems, `${at}.map`, value.map);
  if (typeof value.type === "string" && MAPLESS_GROUP_TYPES.has(value.type) && value.map !== null) {
    problems.push(`${at}.map must be null on a ${value.type} group`);
  }

  if (value.live !== null) {
    if (!isRecord(value.live)) {
      problems.push(`${at}.live must be an object or null`);
    } else {
      if (typeof value.live.state !== "string" || !LIVE_STATES.has(value.live.state)) {
        problems.push(`${at}.live.state is not a live state`);
      }
      checkString(problems, `${at}.live.text`, value.live.text);
    }
  }

  if (value.skip !== null) {
    if (!isRecord(value.skip)) problems.push(`${at}.skip must be an object or null`);
    else checkString(problems, `${at}.skip.reason`, value.skip.reason);
  }

  if (value.earns !== null) checkCurrency(problems, `${at}.earns`, value.earns);
  if (!Array.isArray(value.spends)) problems.push(`${at}.spends must be an array`);
  else value.spends.forEach((s, i) => checkCurrency(problems, `${at}.spends[${i}]`, s));

  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    problems.push(`${at}.rows must be a non-empty array`);
  } else {
    value.rows.forEach((row, index) => checkRow(problems, `${at}.rows[${index}]`, row, build));
    checkLumpedSpend(problems, at, value);
    checkMissingEach(problems, at, value, lookup);
  }

  checkStringList(problems, `${at}.conditions`, value.conditions);
  checkStringList(problems, `${at}.bonuses`, value.bonuses);
  if (!Array.isArray(value.disclosures)) problems.push(`${at}.disclosures must be an array`);
  else value.disclosures.forEach((d, i) => checkDisclosure(problems, `${at}.disclosures[${i}]`, d));
  if (value.quest !== undefined) checkNullableString(problems, `${at}.quest`, value.quest);
  if (value.title !== undefined) checkNullableString(problems, `${at}.title`, value.title);
  checkStoreRefs(problems, at, value, itemName, lookup);
}

const OVERRIDE_KEYS = new Set(["name", "badges", "effort"]);

/** Every reason the value is not a Prime override. `generated` answers whether
 *  the name is a Prime the generator plans; left out, the name goes unchecked. */
export function validatePrimeOverride(
  value: unknown,
  generated?: (name: string) => boolean,
): string[] {
  const problems: Problems = [];
  if (!isRecord(value)) return ["override must be an object"];
  for (const key of Object.keys(value)) {
    if (!OVERRIDE_KEYS.has(key)) problems.push(`${key} is not an override field`);
  }
  checkString(problems, "name", value.name);
  if (typeof value.name === "string" && generated && !generated(value.name)) {
    problems.push(`name "${value.name}" is not a generated Prime`);
  }
  if (value.badges !== undefined) checkBadges(problems, "badges", value.badges);
  if (value.effort !== undefined) {
    if (!isRecord(value.effort)) {
      problems.push("effort must be an object with a value and a reason");
    } else {
      checkEffort(problems, "effort.value", value.effort.value);
      checkString(problems, "effort.reason", value.effort.reason);
    }
  }
  return problems;
}

const STORE_META_KEYS = new Set(["coverage", "conflicts"]);

/** Every reason a table shaped like resources.json breaks the map and harvest
 *  rules, each prefixed with the entry it names. */
export function validateResources(table: unknown): string[] {
  const problems: Problems = [];
  if (!isRecord(table)) return ["resource store must be an object"];
  const lookup = resourceLookup(table);
  for (const [name, entry] of Object.entries(table)) {
    if (STORE_META_KEYS.has(name)) continue;
    if (!isRecord(entry)) {
      problems.push(`${name} must be an object`);
      continue;
    }
    if (typeof entry.alias === "string") continue;
    checkMapKey(problems, `${name}.map`, entry.map);
    if (entry.harvestable === true && entry.map === null) {
      problems.push(`${name}.map must name a map key when harvestable`);
    }
    if (entry.kind === "craft") {
      if (entry.harvestable !== false)
        problems.push(`${name}.harvestable must be false on a craft`);
      if (!Array.isArray(entry.recipe) || entry.recipe.length === 0) {
        problems.push(`${name}.recipe must be a non-empty array on a craft`);
      }
    }
    const sources: [string, unknown][] = [
      ["best", entry.best],
      ...(Array.isArray(entry.alternates) ? entry.alternates : []).map(
        (source, index): [string, unknown] => [`alternates[${index}]`, source],
      ),
    ];
    for (const [where, source] of sources) {
      if (isRecord(source)) checkSource(problems, `${name}.${where}`, source, entry.kind, lookup);
    }
  }
  return problems;
}

/** A crafted entry's meta may carry its foundry credits; nothing else may price in prose. */
function checkSource(
  problems: Problems,
  at: string,
  source: Record<string, unknown>,
  kind: unknown,
  lookup: ResourceLookup,
): void {
  checkProse(problems, `${at}.activity`, source.activity, false);
  checkProse(problems, `${at}.meta`, source.meta, kind === "craft");
  checkPurchase(problems, `${at}.buy`, source.buy);
  if (!isRecord(source.buy) || !Array.isArray(source.buy.price)) return;
  source.buy.price.forEach((price, index) => {
    const currency = isRecord(price) ? price.currency : null;
    if (typeof currency === "string" && lookup(currency)?.spelled !== currency) {
      problems.push(`${at}.buy.price[${index}].currency "${currency}" is not a store spelling`);
    }
  });
}

/** Every reason the value is not an authored plan. The renderer is dumb, so a
 *  malformed plan has to be caught here or not at all. */
export function validatePlan(
  value: unknown,
  lookup: ResourceLookup = resourceEntry,
  shops: (key: string) => AuthoredShop | null = shopFor,
): string[] {
  const problems: Problems = [];
  if (!isRecord(value)) return ["plan must be an object"];

  checkString(problems, "name", value.name);
  checkString(problems, "kind", value.kind);
  if (typeof value.source !== "string" || !SOURCES.has(value.source)) {
    problems.push("source is not a plan source");
  }
  checkEffort(problems, "effort", value.effort);
  if (
    value.tradeable !== null &&
    typeof value.tradeable !== "boolean" &&
    typeof value.tradeable !== "string"
  ) {
    problems.push("tradeable must be a boolean, a string or null");
  }

  if (!isRecord(value.progress)) {
    problems.push("progress must be an object");
  } else {
    if (typeof value.progress.have !== "number") problems.push("progress.have must be a number");
    if (typeof value.progress.need !== "number") problems.push("progress.need must be a number");
    checkString(problems, "progress.unit", value.progress.unit);
  }

  checkBadges(problems, "badges", value.badges);

  if (!Array.isArray(value.prices)) {
    problems.push("prices must be an array");
  } else {
    value.prices.forEach((price, index) => {
      if (!isRecord(price)) {
        problems.push(`prices[${index}] must be an object`);
        return;
      }
      checkString(problems, `prices[${index}].label`, price.label);
      checkString(problems, `prices[${index}].amount`, price.amount);
      if (typeof price.money !== "boolean")
        problems.push(`prices[${index}].money must be a boolean`);
    });
  }

  if (!Array.isArray(value.groups) || value.groups.length === 0) {
    problems.push("groups must be a non-empty array");
  } else {
    const itemName = typeof value.name === "string" ? value.name : "";
    value.groups.forEach((group, index) =>
      checkGroup(problems, `groups[${index}]`, group, itemName, lookup),
    );
  }

  if (value.materials !== undefined) {
    if (!Array.isArray(value.materials)) problems.push("materials must be an array");
    else
      value.materials.forEach((material, index) =>
        checkMaterial(problems, `materials[${index}]`, material, lookup),
      );
  }

  if (value.sequence !== undefined && typeof value.sequence !== "boolean") {
    problems.push("sequence must be a boolean");
  }

  const itemName = typeof value.name === "string" ? value.name : "";
  checkSetTitles(problems, "groups", value.groups, itemName);
  if (isRecord(value.afterQuest)) {
    checkSetTitles(problems, "afterQuest.groups", value.afterQuest.groups, itemName);
  }
  checkAfterQuest(problems, value, itemName, lookup);
  checkRoutes(problems, value);
  checkShop(problems, value, shops);
  return problems;
}

/** Two collapsed sets on one route must not read the same title. */
function checkSetTitles(problems: Problems, at: string, groups: unknown, itemName: string): void {
  if (!Array.isArray(groups)) return;
  const seen = new Map<string, number>();
  groups.forEach((group, index) => {
    if (!isRecord(group) || typeof group.type !== "string" || typeof group.place !== "string") {
      return;
    }
    if (!Array.isArray(group.rows) || !isPartSet({ type: group.type, rows: group.rows })) return;
    const rows = group.rows.filter(isRecord).map((row) => ({
      label: typeof row.label === "string" ? row.label : "",
      blueprint: isRecord(row.buy) && row.buy.blueprint === true,
    }));
    const title = typeof group.title === "string" ? group.title : null;
    const key = setTitleKey(
      setTitle({ type: group.type, place: group.place, title, rows }, itemName),
    );
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else
      problems.push(
        `${at}[${index}] reads the same set title as ${at}[${first}]; give one a title`,
      );
  });
}

/** A plan names a shop that sells its own blueprints. */
function checkShop(
  problems: Problems,
  value: Record<string, unknown>,
  shops: (key: string) => AuthoredShop | null,
): void {
  if (value.shop === undefined) return;
  if (typeof value.shop !== "string" || value.shop === "") {
    problems.push("shop must be a shop key");
    return;
  }
  const shop = shops(value.shop);
  if (!shop) problems.push(`shop "${value.shop}" has no shop file`);
  else if (!shop.wares.some((ware) => ware.item === value.name)) {
    problems.push(`shop "${value.shop}" sells nothing for ${String(value.name)}`);
  }
}
