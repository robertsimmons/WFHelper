import {
  planSteps,
  type PlanCount,
  type PlanLine,
  type PlanModel,
} from "../../../src/components/nextup/plan/planSteps.js";
import { en } from "../../../src/i18n/en.js";
import { formatNumber } from "../../../src/lib/format.js";
import type { Translator } from "../../../src/lib/i18n.js";
import { resolvePlan, type AuthoredPlan } from "../../../src/lib/suggest/acquisition/plan/index.js";
import type { PartPlan } from "../../../src/lib/suggest/acquisition/types.js";
import type { ItemDbEntry, RawInventoryData } from "../../../src/types/inventory.js";

/** Plan steps as text: the snapshot test and `pnpm plan:text` both print through
 *  here, so the two never disagree about what a screen says. */
export const t: Translator = (key, params = {}) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

const SNAPSHOT_NOW = Date.parse("2026-10-10T00:00:00Z");

const loaded = import.meta.glob<{ default: AuthoredPlan }>(
  "../../../src/data/suggest/acquisitionPlans/plan-*.json",
  { eager: true },
);

/** Every shipped plan by the slug its file is named for. */
export const PLAN_FILES = Object.entries(loaded)
  .map(([path, module]) => ({
    file: path.replace(/^.*\/plan-(.+)\.json$/, "$1"),
    plan: module.default,
  }))
  .sort((left, right) => left.file.localeCompare(right.file));

/** A plan in a fixed state: one copy, parts unread, at a pinned instant. */
export function authoredStateModel(
  plan: AuthoredPlan,
  itemDb: Record<string, ItemDbEntry>,
  inventory: RawInventoryData | null,
): PlanModel {
  const parts = { known: false, copies: 1 } as PartPlan;
  const resolved = resolvePlan(plan, { itemDb, inventory, now: SNAPSHOT_NOW }, null, {
    uniqueName: plan.name,
    parts,
  });
  return planSteps(resolved, { t });
}

const SECTION = {
  get: "nextUp.sectionGet",
  farm: "nextUp.sectionFarm",
  build: "nextUp.sectionBuild",
} as const;

function count(value: PlanCount | null): string {
  if (!value) return "";
  const have = value.have === null ? "" : `${formatNumber(value.have)} / `;
  return ` ${have}${formatNumber(value.need)}`;
}

function map(entry: PlanLine): string {
  return entry.drawer.map?.ready ? ` [${t("nextUp.planMap")}]` : "";
}

function title(entry: PlanLine): string {
  const parts = entry.parts.map((part) => ` <${part.label}${part.done ? " ✓" : ""}>`);
  const chips = entry.chips
    .filter((chip) => !chip.done)
    .map((chip) => ` {${chip.title}${count(chip.count)}${map(chip)}}`);
  const live = entry.live ? ` !${entry.live}` : "";
  return `${entry.title}${count(entry.count)}${parts.join("")}${chips.join("")}${live}${map(entry)}`;
}

function marks(entry: PlanLine): string {
  return entry.next ? `${t("nextUp.lineNext").toUpperCase()} ` : "";
}

function line(entry: PlanLine): string {
  if (entry.done) return `  [x] ${entry.title}`;
  const meta = entry.cost ?? entry.tag;
  const right = meta ? `  |  ${meta}` : "";
  const blocked = entry.blocked ? "  (blocked)" : "";
  return `  [ ] ${marks(entry)}${title(entry)}${right}${blocked}`;
}

export function renderSteps(steps: PlanModel): string {
  const out: string[] = [];
  steps.sections.forEach((section, index) => {
    out.push(`${index + 1} ${t(SECTION[section.key])}`);
    for (const entry of section.entries) {
      if (entry.kind !== "trip") {
        out.push(line(entry));
        continue;
      }
      out.push(`  [ ] ${entry.next ? `${t("nextUp.lineNext").toUpperCase()} ` : ""}${entry.place}`);
      for (const stop of entry.lines) {
        out.push(`      - ${marks(stop)}${title(stop)}${stop.blocked ? "  (blocked)" : ""}`);
      }
    }
  });
  if (steps.sections.length === 0) out.push(t("nextUp.planAllDone"));
  if (steps.done.length > 0) {
    out.push(t("nextUp.linesDone", { count: steps.done.length }));
    out.push(...steps.done.map(line));
  }
  return out.join("\n");
}

/** Every line the model draws, open ones in screen order, then the done ones. */
export function planLines(steps: PlanModel): PlanLine[] {
  return [
    ...steps.sections.flatMap((section) =>
      section.entries.flatMap((entry) => (entry.kind === "trip" ? entry.lines : [entry])),
    ),
    ...steps.done,
  ];
}

function links(entry: PlanLine): string {
  const mapKey = entry.drawer.map?.ready ? `  map ${entry.drawer.map.key}` : "";
  return `    links: wiki ${entry.drawer.wiki}${mapKey}`;
}

function where(entry: PlanLine): string[] {
  const { drawer } = entry;
  if (!drawer.where && drawer.rates.length === 0) return [];
  return [`    where: ${[drawer.where, ...drawer.rates].filter(Boolean).join(" | ")}`];
}

function chipLines(entry: PlanLine): string[] {
  return entry.chips.flatMap((chip) => [
    `    ${chip.done ? "[x]" : "[ ]"} ${chip.title}${chip.done ? "" : count(chip.count)}`,
    ...where(chip).map((text) => `  ${text}`),
    `  ${links(chip)}`,
  ]);
}

function drawerLines(entry: PlanLine, steps: PlanModel): string[] {
  const { drawer } = entry;
  if (entry.kind === "basics") return chipLines(entry);
  const out = [...where(entry)];
  for (const part of drawer.parts) {
    const extras = [part.done ? "" : count(part.count).trim(), part.cost, part.note];
    const tail = extras.filter(Boolean).join("  ");
    out.push(`    ${part.done ? "[x]" : "[ ]"} ${part.label}${tail ? `  ${tail}` : ""}`);
  }
  if (drawer.lead) out.push("    (lead: the surface's item facts open here)");
  for (const note of drawer.notes) out.push(`    ${t("nextUp.drawerNotes")}: ${note}`);
  for (const spot of drawer.other) out.push(`    ${t("nextUp.drawerOther")}: ${spot}`);
  for (const alt of drawer.alts) {
    const state = alt.offer ? (alt.taken ? "  (offer, taken)" : "  (offer)") : "";
    out.push(`    ${alt.label}: ${alt.text}${state}`);
  }
  for (const item of drawer.disclosures) out.push(`    > ${item.title}: ${item.body}`);
  for (const tip of drawer.tips) out.push(`    tip [${tip.kind}, ${tip.consensus}]: ${tip.text}`);
  if (entry.picker && steps.shop) {
    const shop = steps.shop;
    out.push(`    shop picker: ${shop.vendor}, ${shop.place}`);
    for (const note of shop.notes) out.push(`      ${note}`);
  }
  out.push(links(entry));
  return out;
}

/** What each line holds back until it is opened, which the step text leaves out. */
export function renderDrawers(steps: PlanModel): string {
  return planLines(steps)
    .map((entry) => {
      const state = entry.done ? "[x]" : "[ ]";
      const head = `${state} ${entry.title}  (${entry.section}/${entry.kind} ${entry.id})`;
      return [head, ...drawerLines(entry, steps)].join("\n");
    })
    .join("\n");
}
