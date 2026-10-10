import { anchorIndex, type AnchorGroup } from "./anchor.js";
import { DISPUTE_STATUSES, TIP_CONSENSUS, TIP_KINDS } from "./schema.js";
import { materialGroups } from "../plan/materials.js";
import { generatedSteps } from "../plan/prime.js";
import { PLAN_GROUP_TYPES, type AuthoredPlan } from "../plan/schema.js";
import type { ResourceLookup } from "../plan/resources.js";

const KINDS = new Set<string>(TIP_KINDS);
const CONSENSUS = new Set<string>(TIP_CONSENSUS);
const STATUSES = new Set<string>(DISPUTE_STATUSES);
const GROUP_TYPES = new Set<string>(PLAN_GROUP_TYPES);
const FILE_KEYS = new Set(["name", "tips", "removed"]);
const ANCHOR_KEYS = new Set(["route", "group", "place", "row"]);
const WIKI = /^https:\/\/wiki\.warframe\.com\/w\/\S+$/;
/** Tips are never refreshed, so nothing in one may name a moment. */
const DATED = /\bcurrently\b|\b(?:19|20)\d{2}\b/i;

type Problems = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function checkText(problems: Problems, at: string, value: unknown): void {
  if (!isText(value)) problems.push(`${at} must be a non-empty string`);
}

/** The steps an item's tips can anchor to: its authored plan's groups, every step
 *  a generated Prime plan can hold, or the farm the store builds for a material.
 *  `rows` false means row labels change at runtime and cannot be checked. */
export interface TipsTarget {
  groups: AnchorGroup[];
  rows: boolean;
}

export type TipsTargetLookup = (name: string) => TipsTarget | null;

export function authoredTarget(plan: AuthoredPlan): TipsTarget {
  return {
    rows: true,
    groups: [
      ...plan.groups.map((group) => ({ ...group, route: "chosen" as const })),
      ...(plan.afterQuest?.groups ?? []).map((group) => ({
        ...group,
        route: "afterQuest" as const,
      })),
    ],
  };
}

export function generatedTarget(lookup?: ResourceLookup): TipsTarget {
  return {
    rows: false,
    groups: generatedSteps(lookup).map((step) => ({ ...step, rows: [], route: "chosen" })),
  };
}

export function storeTarget(name: string, lookup: ResourceLookup): TipsTarget {
  const groups = materialGroups([{ label: name, qty: 1, note: null }], lookup);
  return { rows: true, groups: groups.map((group) => ({ ...group, route: "chosen" })) };
}

function checkAnchor(
  problems: Problems,
  at: string,
  value: unknown,
  kind: unknown,
  target: TipsTarget | null,
): void {
  if (kind === "sentiment") {
    if (value !== null) problems.push(`${at} must be null on a sentiment tip`);
    return;
  }
  if (!isRecord(value)) {
    problems.push(`${at} must name the step the tip is about`);
    return;
  }
  for (const field of Object.keys(value)) {
    if (!ANCHOR_KEYS.has(field)) problems.push(`${at}.${field} is not an anchor field`);
  }
  if (value.route !== undefined && value.route !== "afterQuest") {
    problems.push(`${at}.route must be afterQuest or absent`);
  }
  if (typeof value.group !== "string" || !GROUP_TYPES.has(value.group)) {
    problems.push(`${at}.group is not a plan group type`);
    return;
  }
  if (value.place !== undefined) checkText(problems, `${at}.place`, value.place);
  if (value.row !== undefined) checkText(problems, `${at}.row`, value.row);
  if (!target) return;
  const anchor = value as unknown as Parameters<typeof anchorIndex>[1];
  const index = anchorIndex(target.groups, anchor);
  if (index === -1) {
    problems.push(`${at} matches no group in the plan`);
    return;
  }
  if (typeof anchor.row !== "string") return;
  if (!target.rows) {
    problems.push(`${at}.row cannot be checked on a generated plan; anchor by group and place`);
    return;
  }
  const row = anchor.row.toLowerCase();
  const rows = target.groups[index].rows;
  if (!rows.some((entry) => entry.label.toLowerCase().includes(row))) {
    problems.push(`${at}.row "${anchor.row}" matches no row in that group`);
  }
}

function checkTipText(problems: Problems, at: string, value: unknown): void {
  checkText(problems, at, value);
  if (typeof value !== "string") return;
  if (value.includes("—")) problems.push(`${at} has an em dash`);
  if (DATED.test(value)) problems.push(`${at} names a date or "currently"`);
}

/** Every reason the value is not a tips file. `target` answers which steps its
 *  item's plan has; null means the name is not an item anything can plan. */
export function validateTips(value: unknown, target: TipsTargetLookup): string[] {
  const problems: Problems = [];
  if (!isRecord(value)) return ["tips file must be an object"];
  for (const field of Object.keys(value)) {
    if (!FILE_KEYS.has(field)) problems.push(`${field} is not a tips file field`);
  }
  checkText(problems, "name", value.name);
  const steps = typeof value.name === "string" ? target(value.name) : null;
  if (typeof value.name === "string" && !steps) {
    problems.push(`name "${value.name}" is no authored plan, generated Prime or store key`);
  }

  const ids = new Set<string>();
  const claimId = (at: string, id: unknown): void => {
    checkText(problems, `${at}.id`, id);
    if (typeof id !== "string") return;
    if (ids.has(id)) problems.push(`${at}.id "${id}" is used twice`);
    ids.add(id);
  };

  const removedTexts = new Set<string>();
  if (!Array.isArray(value.removed)) {
    problems.push("removed must be an array");
  } else {
    value.removed.forEach((entry, index) => {
      const at = `removed[${index}]`;
      if (!isRecord(entry)) {
        problems.push(`${at} must be an object`);
        return;
      }
      claimId(at, entry.id);
      checkText(problems, `${at}.text`, entry.text);
      checkText(problems, `${at}.reason`, entry.reason);
      if (typeof entry.wiki !== "string" || !WIKI.test(entry.wiki)) {
        problems.push(`${at}.wiki must be a wiki.warframe.com URL`);
      }
      if (typeof entry.text === "string") removedTexts.add(entry.text.trim().toLowerCase());
    });
  }

  if (!Array.isArray(value.tips)) {
    problems.push("tips must be an array");
    return problems;
  }
  const texts = new Set<string>();
  value.tips.forEach((tip, index) => {
    const at = `tips[${index}]`;
    if (!isRecord(tip)) {
      problems.push(`${at} must be an object`);
      return;
    }
    claimId(at, tip.id);
    checkTipText(problems, `${at}.text`, tip.text);
    if (typeof tip.text === "string") {
      const text = tip.text.trim().toLowerCase();
      if (texts.has(text)) problems.push(`${at}.text repeats another tip`);
      if (removedTexts.has(text)) problems.push(`${at}.text was removed; it cannot come back`);
      texts.add(text);
    }
    if (typeof tip.kind !== "string" || !KINDS.has(tip.kind)) {
      problems.push(`${at}.kind is not a tip kind`);
    }
    if (typeof tip.consensus !== "string" || !CONSENSUS.has(tip.consensus)) {
      problems.push(`${at}.consensus is not a consensus level`);
    }
    checkAnchor(problems, `${at}.anchor`, tip.anchor, tip.kind, steps);
  });
  return problems;
}

/** Every reason the disputes list does not hold up against the tips files: a
 *  dispute names a live tip, unless it was confirmed, which moved the tip to
 *  `removed`. */
export function validateDisputes(
  value: unknown,
  files: readonly { name: string; tips: { id: string }[]; removed: { id: string }[] }[],
): string[] {
  if (!Array.isArray(value)) return ["disputes must be an array"];
  const problems: Problems = [];
  const byName = new Map(files.map((file) => [file.name.trim().toLowerCase(), file]));
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const at = `disputes[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} must be an object`);
      return;
    }
    checkText(problems, `${at}.item`, entry.item);
    checkText(problems, `${at}.tipId`, entry.tipId);
    checkText(problems, `${at}.claim`, entry.claim);
    if (typeof entry.wiki !== "string" || !WIKI.test(entry.wiki)) {
      problems.push(`${at}.wiki must be a wiki.warframe.com URL`);
    }
    if (typeof entry.status !== "string" || !STATUSES.has(entry.status)) {
      problems.push(`${at}.status must be open, confirmed or dismissed`);
    }
    if (typeof entry.item !== "string" || typeof entry.tipId !== "string") return;
    const key = `${entry.item.toLowerCase()}|${entry.tipId}|${String(entry.claim).toLowerCase()}`;
    if (seen.has(key)) problems.push(`${at} files the same claim twice`);
    seen.add(key);
    const file = byName.get(entry.item.trim().toLowerCase());
    if (!file) {
      problems.push(`${at}.item "${entry.item}" has no tips file`);
      return;
    }
    const live = file.tips.some((tip) => tip.id === entry.tipId);
    const removed = file.removed.some((tip) => tip.id === entry.tipId);
    if (entry.status === "confirmed" && (live || !removed)) {
      problems.push(`${at} is confirmed, so tip "${entry.tipId}" belongs in removed`);
    } else if (entry.status !== "confirmed" && !live) {
      problems.push(`${at}.tipId "${entry.tipId}" is no live tip of ${entry.item}`);
    }
  });
  return problems;
}
