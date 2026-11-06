import fs from "node:fs";
import path from "node:path";

import { get } from "svelte/store";
import { inject, it } from "vitest";

import {
  resolvePinnedPlans,
  withRowOverrides,
} from "../../../src/components/nextup/plan/planResolution.js";
import { planSteps, type PlanModel } from "../../../src/components/nextup/plan/planSteps.js";
import * as itemDatabase from "../../../services/itemDatabase";
import * as masteryHelper from "../../../services/masteryHelper";
import * as relicService from "../../../services/relicService";
import { advances, needsGain } from "../../../src/lib/suggest/gain.js";
import type {
  AuthoredPlan,
  PlanProgressOverride,
} from "../../../src/lib/suggest/acquisition/plan/index.js";
import type { AcquisitionTarget } from "../../../src/lib/suggest/acquisition/types.js";
import { acquisitionTargets, partsRead } from "../../../src/lib/suggest/providers/acquisition.js";
import { planProgress, planProgressFor } from "../../../src/stores/acquisitionPlanProgress.js";
import { shopPicks } from "../../../src/stores/shopPicks.js";
import { suggestionPreferences } from "../../../src/stores/suggestionPrefs.js";
import type { ItemDbEntry, MasteryData, RawInventoryData } from "../../../src/types/inventory.js";
import type { RelicDatabase } from "../../../src/types/relics.js";
import type { SuggestionContext } from "../../../src/types/suggest.js";
import {
  authoredStateModel,
  PLAN_FILES,
  renderDrawers,
  renderSteps,
  t,
} from "../components/planText.js";
import { readSavedInventory, USER_DATA, type SavedInventory } from "./playerState.js";
import { SAVED_STORAGE } from "./savedStorage.js";

declare module "vitest" {
  export interface ProvidedContext {
    planTextArgs: string[];
  }
}

const REVIEW_DIR = path.resolve(__dirname, "../../../plans/review");

type PlanFile = (typeof PLAN_FILES)[number];

interface Player {
  saved: SavedInventory;
  inventory: RawInventoryData;
  mastery: MasteryData | null;
  relicDb: RelicDatabase | null;
  targets: AcquisitionTarget[];
  now: number;
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

function findPlan(query: string): PlanFile | string {
  const needle = squash(query);
  const hit = PLAN_FILES.find(
    (entry) => squash(entry.file) === needle || squash(entry.plan.name) === needle,
  );
  if (hit) return hit;
  const near = PLAN_FILES.map((entry) => ({
    entry,
    score: squash(entry.plan.name).includes(needle) ? 0 : distance(needle, squash(entry.plan.name)),
  }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(({ entry }) => `${entry.plan.name} (${entry.file})`);
  return `No plan matches "${query}". Near matches: ${near.join(", ")}`;
}

function loadItemDb(): Record<string, ItemDbEntry> {
  itemDatabase.buildDatabase();
  return itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
}

function loadRelicDb(): RelicDatabase | null {
  try {
    return relicService.getRelicDatabase() as unknown as RelicDatabase;
  } catch {
    return null;
  }
}

/** The sweep the Next Up feed runs, over the same saved inventory and settings. */
function loadPlayer(itemDb: Record<string, ItemDbEntry>): Player | string {
  const saved = readSavedInventory();
  if (!saved.data) return saved.error ?? "inventory unreadable";
  const inventory = saved.data;
  const mastery = masteryHelper.computeMasteryProgress(
    inventory as Record<string, unknown>,
  ) as unknown as MasteryData;
  const relicDb = loadRelicDb();
  const now = Date.now();
  const context = {
    itemDb,
    inventory,
    mastery,
    relicDb,
    plat: null,
    world: null,
    prefs: get(suggestionPreferences),
    nowMs: now,
  } as unknown as SuggestionContext;
  return { saved, inventory, mastery, relicDb, targets: acquisitionTargets(context), now };
}

/** The part count the pinned card hands the plan, as Next Up words it. */
function progressFor(target: AcquisitionTarget): PlanProgressOverride | undefined {
  const read = partsRead(target);
  if (!read) return undefined;
  const unit = t(read.unitKey ?? (read.need === 1 ? "nextUp.acqUnitPart" : "nextUp.acqUnitParts"));
  return { have: read.have, need: read.need, unit, ready: read.ready };
}

function targetFor(plan: AuthoredPlan, player: Player): AcquisitionTarget | null {
  return player.targets.find((target) => squash(target.name) === squash(plan.name)) ?? null;
}

function robModel(
  plan: AuthoredPlan,
  player: Player,
  itemDb: Record<string, ItemDbEntry>,
): { model: PlanModel | null; note: string } {
  const found = targetFor(plan, player);
  const target = found ?? { name: plan.name, tier: null };
  const uniqueName = found?.uniqueName ?? plan.name;
  const answers = planProgressFor(get(planProgress), uniqueName);
  const plans = resolvePinnedPlans(
    [{ uniqueName, target, progress: found ? progressFor(found) : undefined, answers }],
    {
      itemDb,
      inventory: player.inventory,
      mastery: player.mastery,
      world: null,
      relicDb: player.relicDb,
      now: player.now,
      shopPicks: get(shopPicks),
    },
  );
  const resolved = plans[uniqueName];
  // Row overrides live only while the plan page is open and are never saved.
  const model = resolved ? planSteps(withRowOverrides(resolved, {}), { t }) : null;
  const card = found
    ? `needs ${found.needs.join("+") || "none"}${advances(needsGain(found.needs)) ? "" : " (not on Next Up)"}, copies ${found.parts.copies}`
    : "no acquisition target (owned or unlisted), parts unsized";
  const ticks = `answers ${answers.manualDone.length} ticked / ${answers.manualCleared.length} cleared / ${answers.altsTaken.length} alts`;
  return { model, note: `${card}; ${ticks}` };
}

function stateLine(player: Player): string {
  const { saved } = player;
  const when = saved.modifiedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "?";
  const storage = SAVED_STORAGE.error ?? `local storage ${SAVED_STORAGE.values.size} keys`;
  return `state: ${saved.path} (${when}), ${storage}; not read: world state, plat prices`;
}

function planText(
  entry: PlanFile,
  itemDb: Record<string, ItemDbEntry>,
  player: Player | string,
): string {
  const { plan } = entry;
  const full = authoredStateModel(plan, itemDb, {});
  const blocks = [`== ${plan.name}, full plan ==\n${renderSteps(full)}\n`];
  let drawers = full;
  if (typeof player === "string") {
    blocks.push(
      `== ${plan.name}, for Rob ==\nstate unreadable: ${player} (userData ${USER_DATA})\n`,
    );
  } else {
    const rob = robModel(plan, player, itemDb);
    const body = rob.model ? renderSteps(rob.model) : "no plan resolved for this item";
    blocks.push(`== ${plan.name}, for Rob ==\n${stateLine(player)}\n${rob.note}\n${body}\n`);
    if (rob.model) drawers = rob.model;
  }
  blocks.push(`== ${plan.name}, drawers ==\n${renderDrawers(drawers)}\n`);
  return blocks.join("\n");
}

function write(entry: PlanFile, text: string): string {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const file = path.join(REVIEW_DIR, `${entry.file}.txt`);
  fs.writeFileSync(file, text);
  return file;
}

function runAll(itemDb: Record<string, ItemDbEntry>, player: Player | string): string {
  const failed: string[] = [];
  let written = 0;
  for (const entry of PLAN_FILES) {
    try {
      write(entry, planText(entry, itemDb, player));
      written++;
    } catch (error) {
      failed.push(`${entry.file} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  const state = typeof player === "string" ? `; for-Rob state unreadable: ${player}` : "";
  const failures = failed.length > 0 ? `; failed ${failed.length}: ${failed.join(", ")}` : "";
  return `wrote ${written} of ${PLAN_FILES.length} plans to ${REVIEW_DIR}${failures}${state}`;
}

function runOne(
  query: string,
  itemDb: Record<string, ItemDbEntry>,
): { output: string; ok: boolean } {
  const entry = findPlan(query);
  if (typeof entry === "string") return { output: entry, ok: false };
  const text = planText(entry, itemDb, loadPlayer(itemDb));
  const file = write(entry, text);
  return { output: `${text}\n(written to ${file})`, ok: true };
}

it("plan text", ({ task }) => {
  const args = inject("planTextArgs");
  const meta = task.meta as Record<string, unknown>;
  const query = args
    .filter((arg) => arg !== "--all")
    .join(" ")
    .trim();
  if (!args.includes("--all") && !query) {
    meta.planText = { output: "usage: pnpm plan:text <plan slug or item name> | --all", ok: false };
    return;
  }
  const itemDb = loadItemDb();
  meta.planText = args.includes("--all")
    ? { output: runAll(itemDb, loadPlayer(itemDb)), ok: true }
    : runOne(query, itemDb);
});
