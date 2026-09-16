import { PLAN_BADGE_TONES, PLAN_GROUP_TYPES, PLAN_LIVE_STATES } from "./schema.js";

const GROUP_TYPES = new Set<string>(PLAN_GROUP_TYPES);
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
}

function checkDisclosure(problems: Problems, at: string, value: unknown): void {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return;
  }
  checkString(problems, `${at}.title`, value.title);
  checkString(problems, `${at}.body`, value.body);
}

function checkGroup(problems: Problems, at: string, value: unknown): void {
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
}

/** Every reason the value is not an authored plan. The renderer is dumb, so a
 *  malformed plan has to be caught here or not at all. */
export function validatePlan(value: unknown): string[] {
  const problems: Problems = [];
  if (!isRecord(value)) return ["plan must be an object"];

  checkString(problems, "name", value.name);
  checkString(problems, "kind", value.kind);
  if (typeof value.effort !== "number" || !Number.isInteger(value.effort)) {
    problems.push("effort must be a whole number");
  } else if (value.effort < 1 || value.effort > 10) {
    problems.push("effort must be 1-10");
  }
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

  if (!Array.isArray(value.badges)) {
    problems.push("badges must be an array");
  } else {
    value.badges.forEach((badge, index) => {
      if (!isRecord(badge)) {
        problems.push(`badges[${index}] must be an object`);
        return;
      }
      checkString(problems, `badges[${index}].text`, badge.text);
      if (typeof badge.tone !== "string" || !BADGE_TONES.has(badge.tone)) {
        problems.push(`badges[${index}].tone is not a badge tone`);
      }
    });
  }

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
    value.groups.forEach((group, index) => checkGroup(problems, `groups[${index}]`, group));
  }

  return problems;
}
