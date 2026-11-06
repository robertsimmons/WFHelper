/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { marketLinks } from "../../../src/components/nextup/plan/marketLinks.js";
import {
  copiesTag,
  planSteps,
  type PlanLine,
  type PlanModel,
} from "../../../src/components/nextup/plan/planSteps.js";
import { en } from "../../../src/i18n/en.js";
import * as itemDatabase from "../../../services/itemDatabase";
import { resolveAcquisition } from "../../../src/lib/suggest/acquisition/index.js";
import {
  authoredPlan,
  resolvePlan,
  resolvePlanFor,
  type PlanContext,
  type ResolvedPlan,
} from "../../../src/lib/suggest/acquisition/plan/index.js";
import type { Translator } from "../../../src/lib/i18n.js";
import type { PartPlan } from "../../../src/lib/suggest/acquisition/types.js";
import type { ItemDbEntry, RawInventoryData } from "../../../src/types/inventory.js";

// Vitest has no Svelte plugin, so the components are read as source.
const PLAN_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "components",
  "nextup",
  "plan",
);
const source = (file: string): string => fs.readFileSync(path.join(PLAN_DIR, file), "utf8");

const t: Translator = (key, params = {}) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

const CRIMSON = "/Lotus/Types/JadeShadowsPart2Mission/Gameplay/Resources/GarudaFavor";
const EMERALD = "/Lotus/Types/JadeShadowsPart2Mission/Gameplay/Resources/AshFavor";
const HUSK = "/Lotus/Types/Gameplay/DuviriMITW/Resources/DuviriMurmurItemB";
const BANE = "/Lotus/Types/Gameplay/Duviri/Resource/DuviriKullervoDropItem";
const PEARL = "/Lotus/Types/Items/MiscItems/ShrineFragment";
const VITUS = "/Lotus/Types/Items/MiscItems/Elitium";
const THALYS_BP = "/Lotus/Types/Recipes/Weapons/ZarimanHeavyScytheIncarnonBlueprint";
const DB: Record<string, ItemDbEntry> = {
  [CRIMSON]: { name: "Crimson Talent" },
  [EMERALD]: { name: "Emerald Talent" },
  [HUSK]: { name: "Scuttler Husk" },
  [BANE]: { name: "Kullervo's Bane" },
  [PEARL]: { name: "Fate Pearl" },
  [VITUS]: { name: "Vitus Essence" },
  [THALYS_BP]: { name: "Thalys Blueprint" },
};

const held = (counts: Record<string, number>, extra: RawInventoryData = {}): RawInventoryData => ({
  MiscItems: Object.entries(counts).map(([ItemType, ItemCount]) => ({ ItemType, ItemCount })),
  ...extra,
});

const allLines = (model: PlanModel): PlanLine[] => [...lines(model), ...model.done];

function titled(model: PlanModel, title: string): PlanLine | undefined {
  return allLines(model).find((entry) => entry.title === title);
}

function shipped(name: string, context: Partial<PlanContext> = {}, copies = 1): ResolvedPlan {
  const plan = authoredPlan(name);
  if (!plan) throw new Error(`no plan for ${name}`);
  const parts = { known: false, copies } as PartPlan;
  return resolvePlan(plan, { itemDb: DB, inventory: null, now: 0, ...context }, null, {
    uniqueName: name,
    parts,
  });
}

let stockedDb: Record<string, ItemDbEntry> = {};

beforeAll(() => {
  itemDatabase.buildDatabase();
  stockedDb = {
    ...(itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>),
    ...DB,
  };
});

/** A shop plan against the real recipes, which is what sizes and owns its wares. */
function stocked(name: string, context: Partial<PlanContext> = {}): ResolvedPlan {
  const inventory = context.inventory ?? null;
  const target = resolveAcquisition({ itemDb: stockedDb, inventory, only: [name] })[0];
  const plan =
    target && resolvePlanFor(target, { itemDb: stockedDb, inventory, now: 0, ...context });
  if (!plan) throw new Error(`no plan for ${name}`);
  return plan;
}

function lines(model: PlanModel): PlanLine[] {
  return model.sections.flatMap((section) =>
    section.entries.flatMap((entry) => (entry.kind === "trip" ? entry.lines : [entry])),
  );
}

describe("plan steps, layout D", () => {
  it("numbers the sections and draws only the ones with something left", () => {
    const text = source("PlanSteps.svelte");
    expect(text).toContain("{#each model.sections as section, index (section.key)}");
    expect(text).toContain('<span class="text-accent">{index + 1}</span>');
    expect(text).toContain('$tr("nextUp.planAllDone")');
  });

  it("draws a trip as its place, then one chip per pickup that opens its drawer", () => {
    const text = source("PlanSteps.svelte");
    expect(text).toContain('{#if entry.kind === "trip"}');
    expect(text).toContain("data-plan-trip={entry.place}");
    expect(text).toContain("onclick={() => toggle(tripLine.id)}");
    expect(text).toMatch(/\{#if selected\}\s*<StepDrawer entry=\{selected\}/);
  });

  it("highlights the next line and greys a blocked one", () => {
    const line = source("StepLine.svelte");
    expect(line).toContain("data-plan-next={entry.next || undefined}");
    expect(line).toContain("{entry.blocked && !entry.done ? 'opacity-50' : ''}");
    expect(line).toContain('$tr("nextUp.lineNext")');
  });

  it("folds done lines behind one N done toggle, closed until clicked", () => {
    const text = source("PlanSteps.svelte");
    expect(text).toContain("let showDone = $state(false);");
    expect(text).toContain('$tr("nextUp.linesDone", { count: model.done.length })');
    expect(text).toMatch(/\{#if showDone\}\s*\{#each model\.done as entry/);
  });

  it("draws counts as have / need with a bar, need only while unread", () => {
    const count = source("PlanCount.svelte");
    expect(count).toMatch(/count\.have === null\s*\? null/);
    expect(count).toContain('{count.have === null ? "" : `${formatNumber(count.have)} / `}');
  });

  it("opens the picker from the shop's buy line and the runs that bank its currency", () => {
    const model = planSteps(stocked("Pride"), { t });
    const pickers = lines(model).filter((entry) => entry.picker);
    expect(pickers.map((entry) => entry.kind).sort()).toEqual(["drop", "drop", "shop"]);
    expect(source("StepDrawer.svelte")).toContain("{#if entry.picker && shop}");
  });

  it("greys the buy until the balance covers the picks, and prices it on the line", () => {
    const short = stocked("Pride", {
      inventory: { MiscItems: [{ ItemType: EMERALD, ItemCount: 10 }] },
    });
    const buy = lines(planSteps(short, { t })).find((entry) => entry.kind === "shop");
    expect(buy?.blocked).toBe(true);
    expect(buy?.cost).toContain("Emerald Talent");
  });
});

describe("a plan's share of a shop", () => {
  // Every Husk ware but Oraxia's own, flipped off so only hers is picked.
  const otherHusk = [
    "Scyotid Blueprint",
    "Scyotid Barrel Blueprint #1",
    "Scyotid Barrel Blueprint #2",
    "Scyotid Gauntlet Blueprint #1",
    "Scyotid Gauntlet Blueprint #2",
    "Thalys Blueprint",
    "Spinnerex Blueprint",
    "Spinnerex Blade Blueprint",
    "Spinnerex Handle Blueprint",
    "Spinnerex String Blueprint",
  ];

  it("counts only its own currency, so a covered buy is next while other picks wait", () => {
    const oraxia = stocked("Oraxia", {
      // Owning Oraxia leaves one build, for the Helminth, and only its Chassis to buy.
      inventory: held(
        { [HUSK]: 89, [BANE]: 14 },
        {
          Suits: [{ ItemType: "/Lotus/Powersuits/Oraxia/Oraxia" }],
          Recipes: ["OraxiaBlueprint", "OraxiaHelmetBlueprint", "OraxiaSystemsBlueprint"].map(
            (name) => ({ ItemType: `/Lotus/Types/Recipes/WarframeRecipes/${name}`, ItemCount: 1 }),
          ),
        },
      ),
      shopPicks: { acrithis: otherHusk },
    });
    const buy = titled(planSteps(oraxia, { t }), "Buy Oraxia Chassis Blueprint");
    expect(buy).toMatchObject({ cost: "20 Scuttler Husk covered", blocked: false, next: true });
    expect(oraxia.shop?.all.totals.find((line) => line.currency === "Kullervo's Bane")).toEqual({
      currency: "Kullervo's Bane",
      balance: 14,
      need: 114,
      short: 100,
    });
  });

  it("has no buy line once its own wares are held, and folds a currency it no longer needs", () => {
    const thalys = stocked("Thalys", {
      inventory: held({ [HUSK]: 89 }, { Recipes: [{ ItemType: THALYS_BP, ItemCount: 1 }] }),
    });
    const model = planSteps(thalys, { t });
    expect(allLines(model).some((entry) => entry.kind === "shop")).toBe(false);
    expect(model.done.map((entry) => entry.title)).toContain("Earn Scuttler Husk");
    expect(lines(model).some((entry) => entry.title === "Earn Scuttler Husk")).toBe(false);
  });

  it("totals every pick in its currency, per currency, and the farm row counts the same", () => {
    const kullervo = stocked("Kullervo", { inventory: held({ [HUSK]: 89, [BANE]: 14 }) });
    const model = planSteps(kullervo, { t });
    expect(titled(model, "Buy Kullervo blueprints")?.cost).toBe("114 Kullervo's Bane short 100");
    expect(titled(model, "Kullervo's Hold")?.count).toEqual({ have: 14, need: 114 });
    expect(kullervo.shop?.all.totals.map((line) => [line.currency, line.balance])).toEqual([
      ["Scuttler Husk", 89],
      ["Kullervo's Bane", 14],
    ]);
  });

  it("adds the recipe's use of a shop currency to the buy and shows it on one row", () => {
    const amanata = stocked("Amanata", { inventory: held({ [PEARL]: 17 }) });
    const model = planSteps(amanata, { t });
    const pearls = amanata.shop?.all.totals[0].need ?? 0;
    expect(amanata.shop?.own.totals[0]).toMatchObject({ need: pearls + 47, balance: 17 });
    expect(titled(model, "Buy Amanata blueprints")?.cost).toContain("Fate Pearl");
    expect(titled(model, "Cetus shrine")?.count).toEqual({ have: 17, need: pearls + 47 });
    expect(titled(model, "Fate Pearl")).toBeUndefined();
  });

  it("draws no count for a currency nothing needs", () => {
    const locators = ["Neuroptics", "Chassis", "Systems"].map((part) => `Grendel ${part} Locator`);
    const grendel = stocked("Grendel", {
      inventory: held({ [VITUS]: 33 }),
      shopPicks: { "arbitration-honors": locators },
    });
    const model = planSteps(grendel, { t });
    expect(lines(model).some((entry) => entry.title === "Earn Vitus Essence")).toBe(false);
    expect(titled(model, "Earn Vitus Essence")).toMatchObject({ done: true, count: null });
  });
});

describe("shop picker", () => {
  const text = source("ShopPicker.svelte");

  it("groups wares by item, cosmetics last, one unit per row with owned marked", () => {
    expect(text).toContain("{#each shop.groups as group (group.item)}");
    expect(text).toContain('$tr("nextUp.pickCosmetics")');
    expect(text).toContain("{#each group.units as unit (unit.id)}");
    expect(text).toContain('$tr("common.owned")');
    expect(text).toContain('$tr("nextUp.pickQuest")');
  });

  it("reads have, need and short per currency, then the either pool and runs", () => {
    for (const key of [
      "nextUp.pickHave",
      "nextUp.pickNeed",
      "nextUp.pickShort",
      "nextUp.pickRuns",
      "nextUp.pickPool",
      "nextUp.pickCovered",
      "nextUp.pickUnread",
    ]) {
      expect(text).toContain(`"${key}"`);
    }
    expect(text).toContain("{#each shop.all.totals as line, index (line.currency)}");
  });

  it("tags the other items the shop serves", () => {
    expect(text).toContain('$tr("nextUp.pickAlso", { items: shop.also.join(", ") })');
  });
});

describe("item header", () => {
  it("always links the wiki and the crafting tree, and the market when tradeable", () => {
    const links = source("AcquisitionLinks.svelte");
    expect(links).toContain("<WikiButton fallbackName={name} />");
    expect(links).toContain("requestCraftingTree();");
    expect(links).toContain("{#if market.length > 0}");
    for (const surface of [
      "AcquisitionPlanPage.svelte",
      path.join("..", "SuggestionDetailsModal.svelte"),
    ]) {
      expect(source(surface)).toContain("<AcquisitionLinks");
    }
  });

  it("finds the set's market page first, else each tradeable part's", () => {
    const FRAME = "/Lotus/Powersuits/Test/Test";
    const NEURO = "/Lotus/Types/Recipes/WarframeRecipes/TestNeuropticsComponent";
    const db: Record<string, ItemDbEntry> = {
      [FRAME]: {
        name: "Test",
        recipe: {
          buildPrice: 1,
          buildTime: 1,
          num: 1,
          ingredients: [{ uniqueName: NEURO, count: 1 }],
        },
      },
      [NEURO]: { name: "Test Neuroptics", tradable: true },
    };
    const lookup = { "test neuroptics": { url_name: "test_neuroptics" } };
    expect(marketLinks(FRAME, db, lookup)).toEqual([
      { part: "Neuroptics", slug: "test_neuroptics" },
    ]);
    expect(marketLinks(FRAME, db, { ...lookup, "test set": { url_name: "test_set" } })).toEqual([
      { part: null, slug: "test_set" },
    ]);
    expect(marketLinks(FRAME, { [FRAME]: { name: "Test" } }, lookup)).toEqual([]);
  });

  it("tags a subsumable Warframe's copies, and nothing else", () => {
    const frame = { ...shipped("Hydroid"), kind: "warframe" };
    expect(copiesTag({ ...frame, copies: 2, needs: ["mastery", "subsume"] })).toBe("two");
    expect(copiesTag({ ...frame, copies: 1, needs: ["mastery", "subsume"] })).toBe("primeOwned");
    expect(copiesTag({ ...frame, copies: 1, needs: ["subsume"] })).toBe("haveOne");
    expect(copiesTag({ ...frame, copies: 1, needs: ["mastery"] })).toBe("subsumed");
    expect(copiesTag({ ...frame, name: "Hydroid Prime", copies: 1 })).toBeNull();
    expect(copiesTag({ ...frame, kind: "melee" })).toBeNull();
  });
});
