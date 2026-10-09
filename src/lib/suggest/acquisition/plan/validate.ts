import { rankSyndicate, topRank } from "./ranks.js";
import { resourceEntry, type ResourceLookup } from "./resources.js";
import { PLAN_BADGE_TONES, PLAN_GROUP_TYPES, PLAN_LIVE_STATES, PLAN_SOURCES } from "./schema.js";

const GROUP_TYPES = new Set<string>(PLAN_GROUP_TYPES);
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

function checkRow(problems: Problems, at: string, value: unknown): void {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return;
  }
  checkString(problems, `${at}.label`, value.label);
  checkNullableString(problems, `${at}.note`, value.note);
  if (value.qty !== null && (typeof value.qty !== "string" || !QUANTITY.test(value.qty))) {
    problems.push(`${at}.qty must be a grouped number string or null`);
  }
  checkAlt(problems, `${at}.alt`, value.alt);
  if (typeof value.done !== "boolean") problems.push(`${at}.done must be a boolean`);
  checkRank(problems, `${at}.rank`, value.rank);
}

function checkRank(problems: Problems, at: string, value: unknown): void {
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
  if (!after.groups.some((group) => isRecord(group) && ROUTE_GROUP_TYPES.has(String(group.type)))) {
    problems.push("afterQuest.groups needs a farm, bounty, boss, vendor, relics or fissure group");
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
    if (!isRecord(row) || !isRecord(row.alt) || !Array.isArray(row.alt.spends)) return;
    row.alt.spends.forEach((spend, at) => {
      if (isRecord(spend)) flows.push([`rows[${index}].alt.spends[${at}]`, spend.currency]);
    });
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
  checkNullableString(problems, `${at}.map`, value.map);

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
    value.rows.forEach((row, index) => checkRow(problems, `${at}.rows[${index}]`, row));
  }

  checkStringList(problems, `${at}.conditions`, value.conditions);
  checkStringList(problems, `${at}.bonuses`, value.bonuses);
  if (!Array.isArray(value.disclosures)) problems.push(`${at}.disclosures must be an array`);
  else value.disclosures.forEach((d, i) => checkDisclosure(problems, `${at}.disclosures[${i}]`, d));
  if (value.quest !== undefined) checkNullableString(problems, `${at}.quest`, value.quest);
  checkStoreRefs(problems, at, value, itemName, lookup);
}

/** Every reason the value is not an authored plan. The renderer is dumb, so a
 *  malformed plan has to be caught here or not at all. */
export function validatePlan(value: unknown, lookup: ResourceLookup = resourceEntry): string[] {
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

  checkAfterQuest(problems, value, typeof value.name === "string" ? value.name : "", lookup);
  return problems;
}
