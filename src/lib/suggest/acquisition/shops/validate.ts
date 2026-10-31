import { checkRank } from "../plan/validate.js";
import { resourceEntry, type ResourceLookup } from "../plan/resources.js";
import { COSMETIC } from "./schema.js";

type Problems = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function checkName(problems: Problems, at: string, value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${at} must be a non-empty string`);
  }
}

function checkCurrencies(problems: Problems, value: unknown, lookup: ResourceLookup): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    problems.push("currencies must list one or two currencies");
    return [];
  }
  const names: string[] = [];
  value.forEach((currency, index) => {
    const at = `currencies[${index}]`;
    if (!isRecord(currency) || typeof currency.name !== "string") {
      problems.push(`${at}.name must be a non-empty string`);
      return;
    }
    const entry = lookup(currency.name);
    if (!entry) problems.push(`${at}.name "${currency.name}" is not in the resource store`);
    else if (entry.spelled !== currency.name) {
      problems.push(`${at}.name "${currency.name}" must be spelled "${entry.spelled}"`);
    }
    if (currency.perRun !== undefined && !isCount(currency.perRun)) {
      problems.push(`${at}.perRun must be a whole number above 0`);
    }
    names.push(currency.name);
  });
  return names;
}

function checkWare(
  problems: Problems,
  at: string,
  ware: unknown,
  currencies: readonly string[],
  plans: ReadonlySet<string>,
): void {
  if (!isRecord(ware)) {
    problems.push(`${at} must be an object`);
    return;
  }
  checkName(problems, `${at}.name`, ware.name);
  if (typeof ware.item !== "string" || (ware.item !== COSMETIC && !plans.has(ware.item))) {
    problems.push(`${at}.item must be "${COSMETIC}" or the name of a plan`);
  }
  if (ware.all !== undefined) {
    const listed = isRecord(ware.price) ? Object.keys(ware.price).length : 0;
    if (ware.all !== true || listed < 2) {
      problems.push(`${at}.all must be true and needs a price in two currencies`);
    }
  }
  if (!isRecord(ware.price) || Object.keys(ware.price).length === 0) {
    problems.push(`${at}.price must name at least one currency`);
  } else {
    for (const [currency, amount] of Object.entries(ware.price)) {
      if (!currencies.includes(currency)) {
        problems.push(`${at}.price.${currency} is not one of the shop's currencies`);
      }
      if (!isCount(amount)) problems.push(`${at}.price.${currency} must be a whole number above 0`);
    }
  }
  checkRank(problems, `${at}.rank`, ware.rank);
}

/** Every reason the value is not a shop file. `plans` holds the planned item names
 *  a ware may belong to. */
export function validateShop(
  value: unknown,
  plans: ReadonlySet<string>,
  lookup: ResourceLookup = resourceEntry,
): string[] {
  const problems: Problems = [];
  if (!isRecord(value)) return ["shop must be an object"];
  checkName(problems, "vendor", value.vendor);
  checkName(problems, "place", value.place);
  const currencies = checkCurrencies(problems, value.currencies, lookup);
  for (const flag of ["either", "together"]) {
    if (value[flag] !== undefined && typeof value[flag] !== "boolean") {
      problems.push(`${flag} must be a boolean`);
    }
  }
  if (
    value.notes !== undefined &&
    (!Array.isArray(value.notes) ||
      value.notes.some((note) => typeof note !== "string" || note === ""))
  ) {
    problems.push("notes must be a list of non-empty strings");
  }
  if (value.either === true && currencies.length < 2) {
    problems.push("either needs two currencies");
  }
  if (!Array.isArray(value.wares) || value.wares.length === 0) {
    problems.push("wares must be a non-empty array");
    return problems;
  }
  const seen = new Set<string>();
  value.wares.forEach((ware, index) => {
    checkWare(problems, `wares[${index}]`, ware, currencies, plans);
    const name = isRecord(ware) && typeof ware.name === "string" ? ware.name.toLowerCase() : null;
    if (name !== null && seen.has(name)) problems.push(`wares[${index}].name repeats a ware`);
    if (name !== null) seen.add(name);
  });
  return problems;
}
