import { beforeAll, describe, expect, it } from "vitest";

import {
  planSteps,
  stepProgress,
  type PlanLine,
  type PlanModel,
} from "../../../src/components/nextup/plan/planSteps.js";
import { withRowOverrides } from "../../../src/components/nextup/plan/planResolution.js";
import * as itemDatabase from "../../../services/itemDatabase";
import { farmNeed } from "../../../src/lib/suggest/acquisition/shops/picker.js";
import { en } from "../../../src/i18n/en.js";
import { resolveAcquisition } from "../../../src/lib/suggest/acquisition/index.js";
import { frame, part } from "../lib/suggest/acquisition/fixtures.js";
import { resources } from "../lib/suggest/acquisition/plan/fixtures.js";
import { resourceLookup } from "../../../src/lib/suggest/acquisition/plan/resources.js";
import {
  authoredPlan,
  resolvePlan,
  resolvePlanFor,
  type AuthoredPlan,
  type PlanContext,
  type ResolvedPlan,
} from "../../../src/lib/suggest/acquisition/plan/index.js";
import type {
  PlanCurrency,
  PlanGroup,
  PlanGroupType,
  PlanRow,
} from "../../../src/lib/suggest/acquisition/plan/schema.js";
import type { Translator } from "../../../src/lib/i18n.js";
import type { PartPlan } from "../../../src/lib/suggest/acquisition/types.js";
import type { ItemDbEntry, RawInventoryData } from "../../../src/types/inventory.js";
import type { RelicDatabase } from "../../../src/types/relics.js";

const t: Translator = (key, params = {}) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

const NOW = Date.parse("2026-10-10T00:00:00Z");
const CRIMSON = "/Lotus/Types/JadeShadowsPart2Mission/Gameplay/Resources/GarudaFavor";
const EMERALD = "/Lotus/Types/JadeShadowsPart2Mission/Gameplay/Resources/AshFavor";
const SIRIUS_NEURO = "/Lotus/Types/Recipes/WarframeRecipes/SiriusOrionHelmetBlueprint";
const WRATH = "/Lotus/Weapons/Tenno/Melee/HeavyScythe/TnOrionSiriusScythe/TnOrionScytheWeapon";
const CAPILLARIES = "/Lotus/Types/Gameplay/EntratiLab/Resources/VesselCapillaries";
const DANTE_NEURO = "/Lotus/Types/Recipes/WarframeRecipes/PagemasterHelmetBlueprint";
const DUCATS = "/Lotus/Types/Items/MiscItems/PrimeBucks";

const DB: Record<string, ItemDbEntry> = {
  [CRIMSON]: { name: "Crimson Talent" },
  [EMERALD]: { name: "Emerald Talent" },
  [SIRIUS_NEURO]: { name: "Sirius & Orion Neuroptics Blueprint" },
  [WRATH]: { name: "Wrath" },
  [CAPILLARIES]: { name: "Vessel Capillaries" },
  [DANTE_NEURO]: { name: "Dante Neuroptics Blueprint" },
  [DUCATS]: { name: "Orokin Ducats" },
};

function shipped(name: string, context: Partial<PlanContext> = {}, copies = 1): ResolvedPlan {
  const plan = authoredPlan(name);
  if (!plan) throw new Error(`no plan for ${name}`);
  // An unknown part plan sizes only the copies, which is all these tests need.
  const parts = { known: false, copies } as PartPlan;
  return resolvePlan(plan, { itemDb: DB, inventory: null, now: NOW, ...context }, null, {
    uniqueName: name,
    parts,
  });
}

function open(model: PlanModel): PlanLine[] {
  return model.sections.flatMap((section) =>
    section.entries.flatMap((entry) => (entry.kind === "trip" ? entry.lines : [entry])),
  );
}

function lineTitled(model: PlanModel, title: string): PlanLine {
  const found = [...open(model), ...model.done].find((entry) => entry.title === title);
  if (!found) throw new Error(`no line ${title}`);
  return found;
}

describe("the three sections", () => {
  it("walks a boss farm: market blueprint, the boss's parts, Basics, then the foundry", () => {
    const model = planSteps(shipped("Hydroid"), { t });
    expect(model.sections.map((section) => section.key)).toEqual(["get", "farm", "build"]);
    const [get, farm, build] = model.sections;
    expect(get.entries.map((entry) => (entry as PlanLine).title)).toEqual([
      "Buy Hydroid Blueprint",
    ]);
    const boss = farm.entries[0] as PlanLine;
    expect(boss.kind).toBe("drop");
    expect(boss.parts.map((entry) => entry.label)).toEqual([
      "Neuroptics Blueprint",
      "Chassis Blueprint",
      "Systems Blueprint",
    ]);
    const basics = farm.entries[farm.entries.length - 1] as PlanLine;
    expect(basics.kind).toBe("basics");
    const titles = basics.chips.map((chip) => chip.title);
    expect(titles).toEqual(expect.arrayContaining(["Polymer Bundle", "Orokin Cell"]));
    expect(titles).not.toContain("Credits");
    expect(build.entries.every((entry) => (entry as PlanLine).blocked)).toBe(true);
  });

  it("marks the first open line next, and only that one", () => {
    const model = planSteps(shipped("Hydroid"), { t });
    const marked = open(model).filter((entry) => entry.next);
    expect(marked.map((entry) => entry.title)).toEqual(["Buy Hydroid Blueprint"]);
  });

  it("turns two or more things at one place into a trip and leaves a lone one a line", () => {
    const model = planSteps(shipped("Gara"), { t });
    const farm = model.sections.find((section) => section.key === "farm");
    const trips = farm?.entries.filter((entry) => entry.kind === "trip") ?? [];
    const plains = trips.find((entry) => entry.place === "Plains of Eidolon, Earth");
    expect(plains?.kind === "trip" && plains.lines.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(["Konzu", "Grokdrul", "Cetus Wisp"]),
    );
    const sepulcrum = planSteps(shipped("Sepulcrum"), { t });
    const lone = sepulcrum.sections[1].entries.find(
      (entry) => entry.kind !== "trip" && entry.title === "Travoride",
    );
    expect(lone).toBeDefined();
  });

  it("buys a crafted material's blueprint in Get, farms its parts and builds it in Build", () => {
    const model = planSteps(shipped("Sepulcrum"), { t });
    const buy = lineTitled(model, "Buy Coprite Alloy Blueprint");
    expect(buy).toMatchObject({ section: "get", rowIds: [] });
    expect(lineTitled(model, "Build Coprite Alloy").section).toBe("build");
    expect(lineTitled(model, "Coprun").section).toBe("farm");
    expect(open(model).some((entry) => entry.title === "Coprite Alloy")).toBe(false);
  });

  describe("a consumed material blueprint is bought once per craft", () => {
    const store = resourceLookup({
      Ore: { kind: "farm", best: { place: "CAMBION DRIFT, DEIMOS", sub: null, activity: "mine" } },
      Batch: {
        kind: "craft",
        yield: 3,
        best: {
          place: "NECRALISK, DEIMOS",
          sub: "Son",
          activity: "buy the blueprint",
          buy: { price: [{ currency: "Entrati Standing", amount: "1,250" }] },
        },
        recipe: [{ qty: 1, label: "Ore" }],
      },
    });
    const buyLine = (qty: string) => {
      const plan = fixture(
        [],
        { materials: [{ qty, label: "Batch", note: null }] },
        {
          resources: store,
        },
      );
      return open(planSteps(plan, { t })).find((entry) => entry.id.endsWith(":bp"));
    };

    it("reads as one purchase for one craft", () => {
      expect(buyLine("3")).toMatchObject({
        title: "Buy Batch Blueprint",
        cost: "1.3K Entrati Standing",
        count: null,
      });
    });

    it("counts and prices each purchase for more than one craft", () => {
      expect(buyLine("4")).toMatchObject({
        title: "Buy Batch Blueprints",
        cost: "1.3K Entrati Standing each",
        count: { have: null, need: 2 },
      });
    });
  });

  it("counts a standing need-only until the balance is read, then have and need", () => {
    const unread = lineTitled(planSteps(shipped("Sepulcrum"), { t }), "Earn Entrati Standing");
    expect(unread.count).toEqual({ have: null, need: 89_000 });
    const read = shipped("Sepulcrum", {
      inventory: { Affiliations: [{ Tag: "EntratiSyndicate", Standing: 3_500, Title: 0 }] },
    });
    expect(lineTitled(planSteps(read, { t }), "Earn Entrati Standing").count).toEqual({
      have: 3_500,
      need: 89_000,
    });
  });

  it("counts an item currency need-only until the inventory is read, never as 0", () => {
    const unread = lineTitled(planSteps(shipped("Supra Vandal"), { t }), "Earn Orokin Ducats");
    expect(unread.count).toEqual({ have: null, need: 500 });
    const read = shipped("Supra Vandal", {
      inventory: { MiscItems: [{ ItemType: DUCATS, ItemCount: 120 }] },
    });
    expect(lineTitled(planSteps(read, { t }), "Earn Orokin Ducats").count).toEqual({
      have: 120,
      need: 500,
    });
    const broke = shipped("Supra Vandal", { inventory: {} });
    expect(lineTitled(planSteps(broke, { t }), "Earn Orokin Ducats").count).toEqual({
      have: 0,
      need: 500,
    });
  });

  it("prices a set of per-unit blueprints at every unit still to buy", () => {
    const buy = lineTitled(planSteps(shipped("Keratinos"), { t }), "Buy Keratinos blueprints");
    expect(buy.cost).toBe("3K Entrati Standing");
  });

  it("never makes credits a step, a chip or a price", () => {
    const model = planSteps(shipped("Arum Spinosa"), { t });
    expect(open(model).some((entry) => entry.kind === "basics")).toBe(false);
    const buy = lineTitled(planSteps(shipped("Argonak"), { t }), "Buy Argonak Blueprint");
    expect(buy.cost).toBeNull();
  });

  it("files a ticked line under done and moves next on, and the counter follows", () => {
    const before = planSteps(shipped("Bad Baby"), { t });
    const first = open(before).find((entry) => entry.next);
    expect(first?.title).toBe("Buy Bad Baby blueprints");
    const after = planSteps(shipped("Bad Baby", { manualDone: first?.rowIds ?? [] }), { t });
    // Every blueprint bought leaves no Ventkids standing owed, so that banks too.
    expect(after.done.map((entry) => entry.title)).toEqual([
      "Buy Bad Baby blueprints",
      "Earn Ventkids Standing",
    ]);
    expect(open(after).find((entry) => entry.next)?.title).toBe("Buy Axidrol Alloy Blueprint");
    expect(stepProgress(after)).toEqual({ step: 3, total: open(after).length + 2 });
  });

  it("gives every line its drawer: where, rates, notes, other spots and a wiki link", () => {
    const model = planSteps(shipped("Hydroid"), { t });
    const basics = open(model).find((entry) => entry.kind === "basics");
    const rubedo = basics?.chips.find((chip) => chip.title === "Rubedo");
    expect(rubedo?.drawer.where).toBe("Zeugma, Phobos");
    expect(rubedo?.drawer.rates).toContain("~250 per 5 min");
    expect(rubedo?.drawer.other).toEqual(["VALEFOR, EUROPA (Excavation)"]);
    expect(rubedo?.drawer.wiki).toBe("https://wiki.warframe.com/w/Rubedo");
    const boss = open(model).find((entry) => entry.kind === "drop");
    expect(boss?.drawer.wiki).toBe("https://wiki.warframe.com/w/Hydroid");
  });

  it("maps a K-Drive's Vallis materials and banks its standing on the same trip", () => {
    const model = planSteps(shipped("Bad Baby"), { t });
    const vallis = model.sections[1].entries.find(
      (entry) => entry.kind === "trip" && entry.place === "Orb Vallis, Venus",
    );
    expect(vallis?.kind === "trip" && vallis.lines[0].title).toBe("Earn Ventkids Standing");
    const scrap = lineTitled(model, "Scrap");
    expect(scrap.drawer.map).toEqual({ key: "orb-vallis", ready: expect.any(Boolean) });
  });
});

function talent(crimson: number, emerald: number, extra: RawInventoryData = {}): RawInventoryData {
  return {
    MiscItems: [
      { ItemType: CRIMSON, ItemCount: crimson },
      { ItemType: EMERALD, ItemCount: emerald },
    ],
    ...extra,
  };
}

describe("a shared shop", () => {
  let itemDb: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    itemDb = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  /** Shop plans resolve against the real recipes, which size and own their wares. */
  function stocked(name: string, context: Partial<PlanContext> = {}): ResolvedPlan {
    const inventory = context.inventory ?? null;
    const target = resolveAcquisition({ itemDb, inventory, only: [name] })[0];
    const plan = target && resolvePlanFor(target, { itemDb, inventory, now: NOW, ...context });
    if (!plan) throw new Error(`no plan for ${name}`);
    return plan;
  }

  const units = (plan: ResolvedPlan, item: string) =>
    plan.shop?.groups.find((group) => group.item === item)?.units ?? [];

  it("buys at Hunhow in Get, one unit per build owed, with the other items it serves", () => {
    const sirius = stocked("Sirius & Orion", { inventory: talent(0, 0) });
    const model = planSteps(sirius, { t });
    expect(lineTitled(model, "Buy Sirius & Orion blueprints").section).toBe("get");
    expect(model.copies).toBe(2);
    expect(model.shop?.also).toEqual(["Pride", "War Prime", "Wrath"]);
    expect(units(sirius, "Sirius & Orion").map((unit) => unit.id)).toEqual([
      "Sirius & Orion Blueprint #1",
      "Sirius & Orion Blueprint #2",
      "Sirius & Orion Neuroptics Blueprint #1",
      "Sirius & Orion Neuroptics Blueprint #2",
      "Sirius & Orion Chassis Blueprint #1",
      "Sirius & Orion Chassis Blueprint #2",
      "Sirius & Orion Systems Blueprint #1",
      "Sirius & Orion Systems Blueprint #2",
    ]);
    // The quest still to finish hands over one main blueprint.
    const [main, second] = units(sirius, "Sirius & Orion");
    expect(main).toMatchObject({ quest: true, picked: false });
    expect(second).toMatchObject({ quest: false, picked: true });
    const cosmetics = model.shop?.groups[model.shop.groups.length - 1];
    expect(cosmetics?.item).toBe("cosmetic");
    expect(cosmetics?.units.every((unit) => !unit.picked)).toBe(true);
  });

  it("sizes a ware by every recipe in the shop that takes it", () => {
    const ids = (plan: ResolvedPlan, ware: string) =>
      [...units(plan, "Pride"), ...units(plan, "Wrath")]
        .filter((unit) => unit.ware === ware)
        .map((unit) => unit.id);
    // Pride and Wrath each take one Pride Blade and one Wrath Blade.
    const both = stocked("Pride", { inventory: talent(0, 0) });
    expect(ids(both, "Pride Blade Blueprint")).toEqual([
      "Pride Blade Blueprint #1",
      "Pride Blade Blueprint #2",
    ]);
    expect(ids(both, "Wrath Blade Blueprint")).toHaveLength(2);
    // A built Wrath owes nothing, so only Pride's blades are left to buy.
    const built = stocked("Pride", { inventory: talent(0, 0, { Melee: [{ ItemType: WRATH }] }) });
    expect(ids(built, "Pride Blade Blueprint")).toEqual(["Pride Blade Blueprint"]);
    expect(ids(built, "Wrath Blade Blueprint")).toEqual(["Wrath Blade Blueprint"]);
  });

  it("owns the wares its recipe consumes, under whichever item the shop lists them", () => {
    const pride = stocked("Pride", { inventory: talent(0, 0, { Melee: [{ ItemType: WRATH }] }) });
    expect(pride.shop?.ownWares).toBe(4);
    expect(pride.shop?.own.totals[0]).toMatchObject({ currency: "Crimson Talent", need: 45 });
  });

  it("marks a looted blueprint owned, and an item already built wants none of its own", () => {
    const inventory = talent(0, 0, {
      Recipes: [{ ItemType: SIRIUS_NEURO, ItemCount: 1 }],
      Melee: [{ ItemType: WRATH }],
    });
    const sirius = stocked("Sirius & Orion", { inventory });
    const neuro = units(sirius, "Sirius & Orion").find(
      (unit) => unit.id === "Sirius & Orion Neuroptics Blueprint #1",
    );
    expect(neuro?.owned).toBe(true);
    expect(units(sirius, "Wrath").map((unit) => unit.ware)).toEqual(["Wrath Blade Blueprint"]);
  });

  it("greys the buy until the balance covers the picks, and a boss line counts its Talent", () => {
    const flipped = ["Pride Blueprint", "Pride Blade Blueprint", "Pride Handle Blueprint"];
    const short = stocked("Sirius & Orion", {
      inventory: talent(100, 20, { Melee: [{ ItemType: WRATH }] }),
      shopPicks: { hunhow: flipped },
    });
    const model = planSteps(short, { t });
    const totals = short.shop?.own.totals ?? [];
    expect(lineTitled(model, "Buy Sirius & Orion blueprints").blocked).toBe(true);
    expect(lineTitled(model, "Scoria's Angel").count).toEqual({
      have: 100,
      need: farmNeed(totals, "Crimson Talent"),
    });
    expect(open(model).find((entry) => entry.next)?.title).not.toBe("Buy Sirius & Orion blueprints");

    const rich = stocked("Sirius & Orion", {
      inventory: talent(5_000, 5_000, { Melee: [{ ItemType: WRATH }] }),
      shopPicks: { hunhow: flipped },
    });
    expect(lineTitled(planSteps(rich, { t }), "Buy Sirius & Orion blueprints").blocked).toBe(false);
  });

  it("reads a single-currency shop with no per-run yield as runs unknown", () => {
    const inventory: RawInventoryData = {
      MiscItems: [{ ItemType: CAPILLARIES, ItemCount: 60 }],
      Recipes: [{ ItemType: DANTE_NEURO, ItemCount: 1 }],
    };
    const dante = stocked("Dante", { inventory });
    const neuro = units(dante, "Dante").find((unit) => unit.ware === "Dante Neuroptics Blueprint");
    expect(neuro?.owned).toBe(true);
    expect(dante.shop?.all.totals[0]).toMatchObject({
      currency: "Vessel Capillaries",
      balance: 60,
    });
    expect(dante.shop?.all.runs).toBeNull();
    expect(dante.shop?.also).toEqual(["Onos", "Ruvox"]);
  });

  it("charges Citrine's fragments together", () => {
    const citrine = stocked("Citrine");
    expect(citrine.shop?.key).toBe("otak");
    expect(citrine.shop?.all.totals.every((line) => line.currency !== null)).toBe(true);
    const get = planSteps(citrine, { t }).sections[0].entries;
    expect(get.map((entry) => (entry as PlanLine).title)).toContain("Buy Citrine blueprints");
  });
});

const PRIME = "Testframe Prime";
const PRIME_ID = "/Lotus/Powersuits/Testframe/TestframePrime";
const PRIME_BP = "/Lotus/Types/Recipes/WarframeRecipes/TestframePrimeBlueprint";
const PRIME_SYS = "/Lotus/Types/Recipes/WarframeRecipes/TestframePrimeSystemsComponent";

function primeDb(): Record<string, ItemDbEntry> {
  return {
    [PRIME_ID]: frame(PRIME, PRIME_BP, [PRIME_SYS]),
    [PRIME_BP]: { name: `${PRIME} Blueprint`, buildsProduct: PRIME_ID, tradable: true },
    [PRIME_SYS]: part(`${PRIME} Systems`),
  };
}

function primeRelics(): RelicDatabase {
  const uniqueName = "/Lotus/Types/Game/Projections/LithT1Bronze";
  const rewards = [
    [`${PRIME} Blueprint`, PRIME_BP],
    [`${PRIME} Systems Blueprint`, PRIME_SYS.replace("Component", "Blueprint")],
  ].map(([name, id]) => ({
    name,
    uniqueName: id,
    rarity: "common",
    chance: 25,
    urlName: null,
    ducats: 45,
  }));
  return {
    groups: {
      "Lith T1": {
        key: "Lith T1",
        name: "Lith T1",
        tier: "Lith",
        code: "T1",
        vaulted: false,
        dropping: "missions",
        caches: [],
        imageUrl: null,
        qualities: { intact: { uniqueName, rewards } },
      },
    },
    byUniqueName: { [uniqueName]: { groupKey: "Lith T1", quality: "intact" } },
  };
}

describe("a Prime", () => {
  it("draws its generated plan through the same sections, fissures in Farm", () => {
    const db = primeDb();
    const relics = primeRelics();
    const [target] = resolveAcquisition({
      itemDb: db,
      inventory: null,
      relicDb: relics,
      only: [PRIME],
    });
    if (!target) throw new Error("no target");
    const plan = resolvePlanFor(
      { ...target, tier: null },
      { itemDb: db, inventory: null, relicDb: relics, world: null, now: NOW },
    );
    if (!plan) throw new Error("no plan");
    const model = planSteps(plan, { t });
    const lines = open(model);
    expect(lines[lines.length - 1]?.title).toBe(`Build ${PRIME}`);
    const farm = model.sections.find((section) => section.key === "farm");
    expect(
      farm?.entries.some(
        (entry) => entry.kind !== "trip" && entry.place.includes("Any Void Fissure"),
      ),
    ).toBe(true);
    expect(model.shop).toBeNull();
  });
});

function row(label: string, price?: PlanCurrency[]): PlanRow {
  return {
    qty: null,
    label,
    note: `${label} note`,
    alt: null,
    done: false,
    buy: price ? { price } : null,
  };
}

function group(type: PlanGroupType, place: string, activity: string, rows: PlanRow[]): PlanGroup {
  return {
    type,
    place,
    sub: null,
    activity,
    meta: null,
    mode: null,
    live: null,
    skip: null,
    earns: null,
    spends: [],
    map: null,
    rows,
    conditions: [],
    bonuses: [],
    disclosures: [],
  };
}

function fixture(
  groups: PlanGroup[],
  extra: Partial<AuthoredPlan> = {},
  context: Partial<PlanContext> = {},
): ResolvedPlan {
  const plan: AuthoredPlan = {
    name: "Testblade",
    kind: "melee",
    source: "unique",
    effort: 5,
    tradeable: false,
    progress: { have: 0, need: 1, unit: "weapon" },
    badges: [],
    prices: [],
    groups,
    ...extra,
  };
  return resolvePlan(plan, { itemDb: DB, inventory: null, now: NOW, ...context }, null);
}

const STANDING_1K: PlanCurrency[] = [{ currency: "Ostron Standing", amount: "1,000" }];
const STANDING_2K: PlanCurrency[] = [{ currency: "Ostron Standing", amount: "2,000" }];
const keys = (model: PlanModel) => model.sections.map((section) => section.key);

describe("empty sections", () => {
  const plan = (manualDone: string[] = []) =>
    fixture(
      [
        group("vendor", "MARKET", "buy the blueprint", [row("Testblade Blueprint", STANDING_1K)]),
        group("boss", "CASSINI, SATURN", "kill the boss", [row("Testblade Blade")]),
        group("foundry", "FOUNDRY", "build it", [row("Testblade")]),
      ],
      {},
      { manualDone },
    );

  it("drops a section with nothing left, so the rest renumber", () => {
    expect(keys(planSteps(plan(), { t }))).toEqual(["get", "farm", "build"]);
    expect(keys(planSteps(plan(["0:0:testblade blueprint"]), { t }))).toEqual(["farm", "build"]);
    expect(keys(planSteps(plan(["2:0:testblade"]), { t }))).toEqual(["get", "farm"]);
  });

  it("gives a weapon that drops built no Build section", () => {
    expect(keys(planSteps(shipped("Kuva Chakkhurr"), { t }))).toEqual(["farm"]);
  });
});

describe("a sequence", () => {
  const steps = [
    group("boss", "CASSINI, SATURN", "spawn the foe", [row("Larvling"), row("progenitor")]),
    group("relics", "KUVA SIPHON", "crack the relics", [row("mods")]),
    group("boss", "CASSINI, SATURN", "defeat the foe", [row("Testblade")]),
  ];

  it("reads each step as its action, one plain line each, pickups in the drawer", () => {
    const model = planSteps(fixture(steps, { sequence: true }), { t });
    const farm = model.sections[0].entries;
    expect(farm.every((entry) => entry.kind !== "trip")).toBe(true);
    const lines = farm as PlanLine[];
    expect(lines.map((entry) => entry.title)).toEqual([
      "Spawn the foe",
      "Crack the relics",
      "Defeat the foe",
    ]);
    expect(lines.every((entry) => entry.parts.length === 0)).toBe(true);
    expect(lines[0].drawer.parts.map((part) => [part.id, part.label, part.note])).toEqual([
      ["0:0:larvling", "Larvling", "Larvling note"],
      ["0:1:progenitor", "progenitor", "progenitor note"],
    ]);
  });

  it("shares a trip and shows pickups as chips when the plan is no sequence", () => {
    const model = planSteps(fixture(steps), { t });
    const trip = model.sections[0].entries.find((entry) => entry.kind === "trip");
    expect(trip?.kind === "trip" && trip.lines.map((entry) => entry.parts.length)).toEqual([2, 1]);
  });

  it("leads with the first step's drawer only", () => {
    const lines = open(planSteps(fixture(steps, { sequence: true }), { t }));
    expect(lines.map((entry) => entry.drawer.lead)).toEqual([true, false, false]);
  });

  it("walks a Kuva Lich spawn first, then mods, sequence and the kill", () => {
    const model = planSteps(shipped("Kuva Chakkhurr"), { t });
    expect(open(model).map((entry) => entry.title)).toEqual([
      "Spawn a Lich with Kuva Chakkhurr",
      "Get Requiem mods: crack Requiem relics",
      "Find the Requiem sequence",
      "Defeat the Lich",
    ]);
    expect(open(model)[0].drawer.lead).toBe(true);
  });

  it("walks a Coda as a sequence with its fusion advice on the buy, not a Build step", () => {
    const plan = shipped("Coda Hema");
    expect(plan.sequence).toBe(true);
    const model = planSteps(plan, { t });
    expect(keys(model)).toEqual(["get", "farm"]);
    expect(lineTitled(model, "Defeat the Technocyte Coda").drawer.parts).toHaveLength(4);
    const buy = lineTitled(model, "Buy Coda Hema");
    expect(buy.drawer.disclosures.map((entry) => entry.title)).toContain(
      "Valence Fusion toward 60%",
    );
  });
});

describe("a set of parts", () => {
  const STRIKES = ["Balla Strike Blueprint", "Ooltha Strike Blueprint", "Kronsh Strike Blueprint"];
  const strikeIds = STRIKES.map((label, index) => `0:${index}:${label.toLowerCase()}`);
  const hok = (manualDone: string[] = []) =>
    fixture(
      [
        group(
          "vendor",
          "HOK, CETUS",
          "buy the strikes",
          STRIKES.map((label) => row(label, STANDING_1K)),
        ),
        group("vendor", "HOK, CETUS", "rank Ostron to Visitor", [
          row("Offworlder rank-up", STANDING_1K),
          row("Visitor rank-up", STANDING_2K),
        ]),
        group("foundry", "FOUNDRY", "build the strikes", [
          row("Balla"),
          { ...row("Peye"), qty: "3" },
        ]),
      ],
      {},
      { manualDone },
    );

  it("collapses one step over several parts into one counted line, priced each when shared", () => {
    const set = lineTitled(planSteps(hok([strikeIds[1]]), { t }), "Buy Testblade blueprints");
    expect(set.count).toEqual({ have: 1, need: 3 });
    expect(set.cost).toBe("1K Ostron Standing each");
    expect(set.rowIds).toEqual(strikeIds);
    expect(set.drawer.parts.map((part) => [part.label, part.done, part.cost])).toEqual([
      ["Balla Strike Blueprint", false, null],
      ["Ooltha Strike Blueprint", true, null],
      ["Kronsh Strike Blueprint", false, null],
    ]);
  });

  it("totals the open parts and prices each in the drawer when prices differ", () => {
    const ranks = lineTitled(planSteps(hok(), { t }), "Buy Testblade parts");
    expect(ranks.count).toEqual({ have: 0, need: 2 });
    expect(ranks.cost).toBe("3K Ostron Standing");
    expect(ranks.drawer.parts.map((part) => part.cost)).toEqual([
      "1K Ostron Standing",
      "2K Ostron Standing",
    ]);
  });

  it("counts a part's quantity as its units, and builds in Build", () => {
    const build = lineTitled(planSteps(hok(), { t }), "Build parts");
    expect(build.section).toBe("build");
    expect(build.count).toEqual({ have: 0, need: 4 });
    expect(build.drawer.parts[1].count).toEqual({ have: 0, need: 3 });
  });

  it("reads a set's title, or falls back by its rows, keeping the activity in the drawer", () => {
    const model = planSteps(hok(), { t });
    expect(lineTitled(model, "Build parts").drawer.rates).toContain("build the strikes");
    const titles = (groups: PlanGroup[]) =>
      open(planSteps(fixture(groups), { t })).map((entry) => entry.title);
    const parts = (labels: string[]) =>
      group(
        "foundry",
        "FOUNDRY",
        "build it all",
        labels.map((label) => row(label)),
      );
    expect(titles([parts(["Blade", "Testblade"])])).toEqual(["Build parts, then Testblade"]);
    expect(titles([{ ...parts(["Blade", "Hilt"]), title: "Blade and Hilt" }])).toEqual([
      "Blade and Hilt",
    ]);
    const ranks = group("vendor", "HOK, CETUS", "rank up", [row("Visitor"), row("Trusted")]);
    expect(titles([{ ...ranks, title: "Ostron rank-ups" }])).toEqual(["Ostron rank-ups at Hok"]);
  });

  it("is done once every part is", () => {
    const model = planSteps(hok(strikeIds), { t });
    expect(model.done.map((entry) => entry.title)).toEqual(["Buy Testblade blueprints"]);
  });

  it("draws a Zaw's blueprints, ranks, builds and gilds as one line each", () => {
    const model = planSteps(shipped("Zaw"), { t });
    const sets = open(model)
      .filter((entry) => entry.drawer.parts.length > 1)
      .map((entry) => [entry.title, entry.count?.need, entry.drawer.rates[0]]);
    expect(sets).toContainEqual([
      "Strike blueprints at Hok",
      9,
      "buy the Ostron Strike blueprints",
    ]);
    expect(sets).toContainEqual([
      "Operational Supply rank-ups at Cetus",
      3,
      "rank Operational Supply to Champion",
    ]);
    expect(sets).toContainEqual(["Gild Zaws at Hok", 11, "gild each Zaw at Hok"]);
    const build = model.sections.find((section) => section.key === "build");
    const own = build?.entries.filter(
      (entry) => entry.kind !== "trip" && entry.rowIds.every((id) => !id.startsWith("m:")),
    );
    expect(own?.map((entry) => entry.kind !== "trip" && entry.title)).toEqual(["Zaw parts"]);
  });
});

describe("a built modular item", () => {
  const BALLA = "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Tip/TipOne";
  const PEYE = "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Handle/HandleOne";
  const ZAW = "/Lotus/Weapons/Ostron/Melee/LotusModularWeapon";
  const db: Record<string, ItemDbEntry> = { [BALLA]: { name: "Balla" }, [PEYE]: { name: "Peye" } };
  const forge = group("vendor", "HOK'S ANVIL", "forge each Zaw", [
    { ...row("forged Zaw"), qty: "2", assembled: true },
  ]);
  const parts = group("foundry", "FOUNDRY", "build the parts", [
    row("Balla"),
    { ...row("Peye"), qty: "2" },
  ]);
  const plan = fixture(
    [parts, forge],
    {},
    {
      itemDb: db,
      inventory: { Melee: [{ ItemType: ZAW, ModularParts: [BALLA, PEYE] }] } as RawInventoryData,
    },
  );

  it("counts assembled items holding the plan's parts", () => {
    expect(lineTitled(planSteps(plan, { t }), "Buy forged Zaw").count).toEqual({
      have: 1,
      need: 2,
    });
  });

  it("counts a part built into one as held", () => {
    const build = lineTitled(planSteps(plan, { t }), "Build parts");
    expect(build.drawer.parts.map((part) => part.done)).toEqual([true, false]);
    expect(build.drawer.parts[1].count).toEqual({ have: 1, need: 2 });
  });
});

/** Fluctus through the card's own resolution: three relay syndicates, each selling
 *  one part for standing behind a climb to rank 3. */
describe("parts bought with standing", () => {
  const SYNDICATES = {
    "Steel Meridian": { tag: "SteelMeridianSyndicate", part: "Stock" },
    "Red Veil": { tag: "RedVeilSyndicate", part: "Limbs" },
    "Cephalon Suda": { tag: "CephalonSudaSyndicate", part: "Barrel" },
  } as const;
  type Syndicate = keyof typeof SYNDICATES;
  const ALL = Object.keys(SYNDICATES) as Syndicate[];
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  interface Player {
    titles?: Partial<Record<Syndicate, number>>;
    standing?: Partial<Record<Syndicate, number>>;
    held?: Syndicate[];
  }

  function builtPart(syndicate: Syndicate): string {
    const name = `Fluctus ${SYNDICATES[syndicate].part}`;
    const found = Object.keys(db).find((uniqueName) => db[uniqueName].name === name);
    if (!found) throw new Error(`no ${name} in the item database`);
    return found;
  }

  function fluctus({ titles = {}, standing = {}, held = [] }: Player = {}): ResolvedPlan {
    const inventory: RawInventoryData = {
      Affiliations: ALL.map((name) => ({
        Tag: SYNDICATES[name].tag,
        Title: titles[name] ?? 0,
        Standing: standing[name] ?? 0,
      })),
      MiscItems: held.map((name) => ({ ItemType: builtPart(name), ItemCount: 1 })),
    };
    const target = resolveAcquisition({ itemDb: db, inventory, only: ["Fluctus"] })[0];
    const plan = target && resolvePlanFor(target, { itemDb: db, inventory, now: NOW });
    if (!plan) throw new Error("no plan for Fluctus");
    return plan;
  }

  const buy = (model: PlanModel, syndicate: Syndicate): PlanLine =>
    lineTitled(model, `Buy Fluctus ${SYNDICATES[syndicate].part} Blueprint`);
  const earn = (model: PlanModel, syndicate: Syndicate): PlanLine =>
    lineTitled(model, `Earn ${syndicate} Standing`);
  const rankUps = (model: PlanModel, syndicate: Syndicate): PlanLine =>
    lineTitled(model, `${syndicate} rank-ups at Relay`);

  it("buys each part as its own step in Get, priced in its standing", () => {
    const model = planSteps(fluctus(), { t });
    for (const syndicate of ALL) {
      expect(buy(model, syndicate)).toMatchObject({
        kind: "buy",
        section: "get",
        cost: `20K ${syndicate} Standing`,
        done: false,
      });
    }
  });

  it("keeps the earn line to the standing owed, its chips no longer the part", () => {
    const model = planSteps(fluctus(), { t });
    const line = earn(model, "Steel Meridian");
    // The initiation is a priced task, a spend: the drawer keeps it, no chip.
    expect(line.parts).toEqual([]);
    expect(line.drawer.parts.map((entry) => entry.label)).toEqual([
      "Fluctus Stock Blueprint",
      "Rank 1",
      "Rank 2",
      "Rank 3, Defender",
    ]);
    expect(line.rowIds).not.toContain(buy(model, "Steel Meridian").rowIds[0]);
    expect(line.count).toEqual({ have: 0, need: 91_000 });
  });

  it("blocks a part while its syndicate's rank is unmet", () => {
    const model = planSteps(fluctus(), { t });
    for (const syndicate of ALL) expect(buy(model, syndicate).blocked).toBe(true);
  });

  it("opens the parts once the ranks are met, the rank-ups done", () => {
    const model = planSteps(
      fluctus({ titles: { "Steel Meridian": 3, "Red Veil": 3, "Cephalon Suda": 3 } }),
      { t },
    );
    for (const syndicate of ALL) {
      expect(buy(model, syndicate)).toMatchObject({ done: false, blocked: false });
      expect(rankUps(model, syndicate).done).toBe(true);
      expect(earn(model, syndicate)).toMatchObject({
        done: false,
        count: { have: 0, need: 20_000 },
      });
    }
  });

  it("files a hated syndicate's steps under done once its part is owned", () => {
    const model = planSteps(fluctus({ titles: { "Cephalon Suda": -2 }, held: ["Cephalon Suda"] }), {
      t,
    });
    expect(model.done).toEqual(
      expect.arrayContaining([
        buy(model, "Cephalon Suda"),
        earn(model, "Cephalon Suda"),
        rankUps(model, "Cephalon Suda"),
      ]),
    );
    for (const syndicate of ["Steel Meridian", "Red Veil"] as const) {
      expect(open(model)).toEqual(
        expect.arrayContaining([
          buy(model, syndicate),
          earn(model, syndicate),
          rankUps(model, syndicate),
        ]),
      );
    }
  });

  it("leaves no standing step open once every part is owned", () => {
    const model = planSteps(fluctus({ held: ALL }), { t });
    for (const syndicate of ALL) {
      expect(
        [buy(model, syndicate), earn(model, syndicate), rankUps(model, syndicate)].every(
          (line) => line.done,
        ),
      ).toBe(true);
    }
  });

  it("banks the earn line once the standing held covers what is owed", () => {
    const banked = planSteps(fluctus({ standing: { "Steel Meridian": 100_000 } }), { t });
    expect(earn(banked, "Steel Meridian")).toMatchObject({
      done: true,
      count: { have: 100_000, need: 91_000 },
    });
    const short = planSteps(fluctus({ standing: { "Steel Meridian": 5_000 } }), { t });
    expect(earn(short, "Steel Meridian")).toMatchObject({
      done: false,
      count: { have: 5_000, need: 91_000 },
    });
  });

  it("settles the rank-ups when the part is ticked on the page", () => {
    const plan = fluctus();
    const stock = buy(planSteps(plan, { t }), "Steel Meridian").rowIds[0];
    const model = planSteps(withRowOverrides(plan, { [stock]: true }), { t });
    expect(rankUps(model, "Steel Meridian").done).toBe(true);
    expect(earn(model, "Steel Meridian").done).toBe(true);
    expect(rankUps(model, "Red Veil").done).toBe(false);
  });
});

describe("a crafted material", () => {
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  function unique(name: string): string {
    const found = Object.entries(db).find(([, entry]) => entry.name === name);
    if (!found) throw new Error(`no item named ${name}`);
    return found[0];
  }

  /** The inventory holding each named item, in the list DE files it under. */
  function holding(held: Record<string, number>): RawInventoryData {
    const items = Object.entries(held).map(([name, count]) => ({
      ItemType: unique(name),
      ItemCount: count,
    }));
    return {
      MiscItems: items.filter((item) => !/\/Types\/Recipes\//i.test(item.ItemType)),
      Recipes: items.filter((item) => /\/Types\/Recipes\//i.test(item.ItemType)),
    } as RawInventoryData;
  }

  function steps(name: string, held: Record<string, number> = {}): PlanModel {
    const plan = authoredPlan(name);
    if (!plan) throw new Error(`no plan for ${name}`);
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory: holding(held), now: NOW }, null, {
      uniqueName: name,
      parts,
    });
    return planSteps(resolved, { t });
  }

  const all = (model: PlanModel): PlanLine[] => [...open(model), ...model.done];

  it("refines a gem in Build, before the item's own build, and never farms the gem itself", () => {
    const model = steps("Korumm");
    const titles = all(model)
      .filter((entry) => entry.section === "build")
      .map((entry) => entry.title);
    expect(titles.indexOf("Refine Radiant Zodian")).toBeLessThan(titles.indexOf("Build Korumm"));
    expect(lineTitled(model, "Refine Radiant Zodian")).toMatchObject({
      kind: "build",
      count: { have: 0, need: 6 },
      place: "Foundry",
      done: false,
    });
    expect(all(model).some((entry) => entry.title === "Radiant Zodian")).toBe(false);
  });

  it("farms a refined gem's raw part at its own spot, with its map", () => {
    const zodian = lineTitled(steps("Korumm"), "Zodian");
    expect(zodian).toMatchObject({ section: "farm", place: "Orb Vallis, Venus" });
    expect(zodian.count).toEqual({ have: 0, need: 6 });
    expect(zodian.drawer.map?.key).toBe("orb-vallis");
  });

  it("builds an alloy with the build verb", () => {
    expect(lineTitled(steps("Korumm"), "Build Coprite Alloy").section).toBe("build");
  });

  it("asks parts only for the crafts the held product leaves short", () => {
    const partial = steps("Korumm", { "Radiant Zodian": 2 });
    expect(lineTitled(partial, "Refine Radiant Zodian").count).toEqual({ have: 2, need: 6 });
    expect(lineTitled(partial, "Zodian").count).toEqual({ have: 0, need: 6 });
    expect(lineTitled(steps("Korumm", { "Radiant Zodian": 3 }), "Zodian").count).toEqual({
      have: 0,
      need: 3,
    });
  });

  it("settles the refine, its parts and the blueprint buy once the product is all held", () => {
    const model = steps("Korumm", { "Radiant Zodian": 6 });
    expect(lineTitled(model, "Refine Radiant Zodian").done).toBe(true);
    expect(lineTitled(model, "Zodian").done).toBe(true);
    expect(lineTitled(model, "Buy Radiant Zodian Blueprint").done).toBe(true);
  });

  it("settles the blueprint buy alone once the reusable blueprint is held", () => {
    const model = steps("Korumm", { "Radiant Zodian Blueprint": 1 });
    expect(lineTitled(model, "Buy Radiant Zodian Blueprint").done).toBe(true);
    expect(lineTitled(model, "Refine Radiant Zodian").done).toBe(false);
    expect(lineTitled(model, "Zodian").done).toBe(false);
  });

  describe("a rank-up ranked only for reusable blueprints", () => {
    const BLUEPRINTS = [
      "Star Amarast Blueprint",
      "Radiant Zodian Blueprint",
      "Marquise Thyst Blueprint",
      "Axidrol Alloy Blueprint",
      "Travocyte Alloy Blueprint",
      "Venerdo Alloy Blueprint",
    ];
    const held = (names: readonly string[]) =>
      Object.fromEntries(names.map((name) => [name, 1] as const));
    const rankUp = (names: readonly string[]): PlanLine =>
      lineTitled(steps("Garuda", held(names)), "Buy rank-ups to Cove");

    it("stays open while none of what it unlocks is held", () => {
      expect(rankUp([]).done).toBe(false);
    });

    it("stays open while one unlocked blueprint is still to buy", () => {
      expect(rankUp(BLUEPRINTS.slice(1)).done).toBe(false);
    });

    it("settles once every blueprint it unlocks is held, the products still to make", () => {
      const model = steps("Garuda", held(BLUEPRINTS));
      expect(lineTitled(model, "Buy rank-ups to Cove").done).toBe(true);
      expect(lineTitled(model, "Refine Radiant Zodian").done).toBe(false);
    });
  });

  it("gets a dropped blueprint in Get, one per craft still short", () => {
    const model = steps("Synapse");
    expect(lineTitled(model, "Get Forma Blueprints")).toMatchObject({
      section: "get",
      count: { have: 0, need: 2 },
      place: "Any Void Fissure",
      rowIds: [],
    });
    expect(lineTitled(model, "Build Forma").count).toEqual({ have: 0, need: 2 });
    const one = steps("Synapse", { Forma: 1 });
    expect(lineTitled(one, "Get Forma Blueprint")).toMatchObject({ count: null, done: false });
    expect(
      lineTitled(steps("Synapse", { Forma: 1, "Forma Blueprint": 1 }), "Get Forma Blueprint").done,
    ).toBe(true);
    const held = steps("Synapse", { Forma: 2 });
    expect(lineTitled(held, "Build Forma").done).toBe(true);
    expect(lineTitled(held, "Get Forma Blueprint").done).toBe(true);
  });
});

describe("a nested craft", () => {
  const plan = (): AuthoredPlan =>
    ({
      ...authoredPlan("Korumm"),
      name: "Lens Rig",
      materials: [{ qty: "4", label: "Veridos Lens", note: null }],
      groups: [
        {
          ...authoredPlan("Korumm")!.groups[1],
          rows: [{ qty: null, label: "Lens Rig", note: null, alt: null, done: false }],
        },
      ],
    }) as AuthoredPlan;

  it("refines the inner craft before building the outer one, both before the item", () => {
    const resolved = resolvePlan(plan(), {
      itemDb: {},
      inventory: null,
      now: NOW,
      resources: resources(),
    });
    const titles = open(planSteps(resolved, { t }))
      .filter((entry) => entry.section === "build")
      .map((entry) => entry.title);
    expect(titles).toEqual(["Refine Marquise Veridos", "Build Veridos Lens", "Build Lens Rig"]);
  });
});

describe("a farm line's chips", () => {
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  function steps(name: string): PlanModel {
    const plan = authoredPlan(name);
    if (!plan) throw new Error(`no plan for ${name}`);
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory: null, now: NOW }, null, {
      uniqueName: name,
      parts,
    });
    return planSteps(resolved, { t });
  }

  const all = (model: PlanModel): PlanLine[] => [...open(model), ...model.done];
  const chips = (entry: PlanLine): string[] => entry.parts.map((part) => part.label);
  const drawn = (entry: PlanLine): string[] => entry.drawer.parts.map((part) => part.label);
  const note = (entry: PlanLine, label: string): string | null =>
    entry.drawer.parts.find((part) => part.label === label)?.note ?? null;
  const earnOf = (model: PlanModel, currency: string): PlanLine =>
    lineTitled(model, `Earn ${currency}`);
  const holding = (model: PlanModel, label: string): PlanLine => {
    const found = all(model).find((entry) => drawn(entry).includes(label));
    if (!found) throw new Error(`no line holds ${label}`);
    return found;
  };

  describe("a currency is never a chip", () => {
    it("counts the line's own currency instead of naming it, and draws the part it buys", () => {
      const line = earnOf(steps("Supra Vandal"), "Orokin Ducats");
      expect(chips(line)).toEqual([]);
      expect(line.count?.need).toBe(500);
      expect(drawn(line)).toEqual(["Supra Vandal"]);
    });

    it("titles a currency group with no figure by the currency its row names, its note in the drawer", () => {
      const line = earnOf(steps("Venari Prime"), "Aya");
      expect(chips(line)).toEqual([]);
      expect(line.drawer.rates).toContain("Level 40-60 bounty, final stage");
      expect(line.drawer.notes).toContain("1 per relic");
      expect(chips(earnOf(steps("Wolf Sledge"), "Nightwave Creds"))).toEqual([]);
    });

    it("keeps its activity as the title when no row names a currency", () => {
      const line = lineTitled(steps("Vizier Predasite"), "Rank Entrati to Associate");
      expect(chips(line)).toEqual([]);
      expect(drawn(line)).toHaveLength(3);
    });
  });

  describe("a rank-up's cost is paid at the rank-up", () => {
    it("moves each sacrifice onto the rank it buys, without its credits", () => {
      const ranks = holding(steps("Vaykor Hek"), "Rank 1, Brave");
      expect(note(ranks, "Rank 1, Brave")).toBe("2 Morphics");
      expect(note(ranks, "Rank 4, Protector")).toBe("2 Aya");
      expect(note(ranks, "Rank 5, General")).toBe("3 Aya");
    });

    it("leaves the earn line no chip, its drawer the rank-ups and part it pays for, unpriced in credits", () => {
      const line = earnOf(steps("Vaykor Hek"), "Steel Meridian Standing");
      expect(chips(line)).toEqual([]);
      expect(drawn(line)).toEqual(["Rank 1, Brave", "Rank 2, Valiant", "Rank 3, Defender", "Rank 4, Protector", "Rank 5, General", "Vaykor Hek"]);
      expect(line.drawer.parts[0].cost).toBeNull();
    });

    it("joins several sacrifices for one rank on its note", () => {
      const ranks = holding(steps("Trumna"), "Entrati Rank 1, Stranger");
      expect(note(ranks, "Entrati Rank 1, Stranger")).toBe(
        "6 Benign Infested Tumor; 6 Ferment Bladder",
      );
    });

    it("keeps a row restating the rank-up in the earn drawer, off the rank-up's note", () => {
      const model = steps("Garuda");
      const line = earnOf(model, "Solaris United Standing");
      expect(chips(line)).toEqual([]);
      expect(drawn(line)).toEqual([
        "rank-ups to Cove",
        "Star Amarast Blueprint",
        "Radiant Zodian Blueprint",
        "Marquise Thyst Blueprint",
        "Axidrol Alloy Blueprint",
        "Travocyte Alloy Blueprint",
        "Venerdo Alloy Blueprint",
      ]);
      expect(lineTitled(model, "Buy rank-ups to Cove").drawer.notes).toEqual([]);
    });

    it("keeps a sacrifice in the earn drawer notes when no vendor ranks its syndicate", () => {
      const gallium: PlanRow = {
        ...row("Gallium"),
        qty: "2",
        rank: { syndicate: "Red Veil", level: 1 },
      };
      const earns: PlanGroup = {
        ...group("currency", "ORBITER", "Earn Red Veil Standing", [gallium]),
        earns: { currency: "Red Veil Standing", amount: "5,000" },
      };
      const line = earnOf(planSteps(fixture([earns]), { t }), "Red Veil Standing");
      expect(chips(line)).toEqual([]);
      expect(line.drawer.notes).toEqual(["Gallium: Gallium note"]);
    });
  });

  describe("a standing line counts what it banks", () => {
    it("counts rows naming the standing on the line, each kept in the drawer", () => {
      const line = earnOf(steps("Cedo"), "Entrati Standing");
      expect(chips(line)).toEqual([]);
      expect(line.count).toEqual({ have: null, need: 260_000 });
      expect(drawn(line)).toEqual([
        "Entrati rank-ups to Family (Rank 5)",
        "Cedo Blueprint",
        "Cedo Barrel",
        "Cedo Receiver",
        "Cedo Stock",
      ]);
    });

    it("counts a standing row with no figure from what the plan spends", () => {
      const line = earnOf(steps("Innodem"), "Holdfasts Standing");
      expect(chips(line)).toEqual([]);
      expect(line.count).toEqual({ have: null, need: 10_500 });
    });

    it("drops a row the plan buys elsewhere, which is what the standing pays for", () => {
      const line = earnOf(steps("Snipetron"), "Operational Supply Standing");
      expect(chips(line)).toEqual([]);
      expect(line.count).toEqual({ have: null, need: 4_000 });
      expect(drawn(line)).toContain("Snipetron Blueprint");
    });
  });

  describe("a spending category is never a chip", () => {
    it.each([
      ["Moa", "Solaris United Standing"],
      ["Garuda", "Solaris United Standing"],
      ["Kompressa", "Ventkids Standing"],
      ["Flatbelly", "Ventkids Standing"],
      ["Aegrit", "Stock"],
      ["Tazicor", "Solaris United Standing"],
    ])("%s banks %s with every category in the drawer", (name, currency) => {
      const line = earnOf(steps(name), currency);
      expect(chips(line)).toEqual([]);
      expect(line.drawer.parts.length).toBeGreaterThan(0);
    });
  });

  describe("a real pickup stays a chip", () => {
    it("keeps the Debt-Bonds a standing trip collects", () => {
      expect(chips(earnOf(steps("Bhaira Hound"), "Solaris United Standing"))).toEqual([
        "Training Debt-Bond",
        "Shelter Debt-Bond",
        "Medical Debt-Bond",
      ]);
    });

    it("keeps the blueprints a currency's mission drops", () => {
      expect(chips(earnOf(steps("Temple"), "Beating Heartstrings"))).toHaveLength(4);
    });

    it("keeps a capture task on a drop line, which is what the trip picks up", () => {
      const line = lineTitled(steps("Crescent Vulpaphyla"), "Vome cycle");
      expect(chips(line)).toEqual(["Weakened Crescent Vulpaphyla"]);
    });
  });

  describe("a drop line", () => {
    it("drops a chip that repeats the line's title", () => {
      const line = lineTitled(steps("Brakk"), "Invasion missions");
      expect(chips(line)).toEqual([]);
      expect(line.count?.need).toBe(5);
    });

    it("makes a purchase its own buy step with its price, off the farm line", () => {
      const price = [{ currency: "Solaris United Standing", amount: "2,500" }];
      const veins = group("farm", "CAMBION DRIFT, DEIMOS", "Teal veins", [
        row("Sunpoint Plasma Drill", price),
        row("Xenorhast"),
      ]);
      const model = planSteps(fixture([veins]), { t });
      const line = lineTitled(model, "Teal veins");
      expect(line.parts.map((part) => part.label)).toEqual(["Xenorhast"]);
      expect(line.drawer.parts.map((part) => part.label)).not.toContain("Sunpoint Plasma Drill");
      const drill = lineTitled(model, "Buy Sunpoint Plasma Drill");
      expect(drill).toMatchObject({
        kind: "buy",
        section: "get",
        cost: "2.5K Solaris United Standing",
      });
      expect(line.rowIds).not.toContain(drill.rowIds[0]);
    });

    it("buys the Arum Spinosa drill from Smokefinger, a tool bought once", () => {
      const drill = lineTitled(steps("Arum Spinosa"), "Buy Sunpoint Plasma Drill");
      expect(drill).toMatchObject({ section: "get", cost: "2.5K Solaris United Standing" });
    });

    it("draws two rows of one thing as one chip, done only when both are", () => {
      const drops = group("farm", "FOSSA, VENUS", "Assassination", [
        row("Neuroptics Blueprint"),
        { ...row("Neuroptics Blueprint"), done: true },
      ]);
      const line = lineTitled(planSteps(fixture([drops]), { t }), "Assassination");
      expect(line.parts).toMatchObject([{ label: "Neuroptics Blueprint", done: false }]);
    });
  });

  describe("a lumped purchase", () => {
    it("buys the Exergis Little Duck parts once each, at the store's price", () => {
      const model = steps("Exergis");
      expect(all(model).some((entry) => /purchases/.test(entry.title))).toBe(false);
      expect(lineTitled(model, "Buy Repeller Systems").cost).toBe("5K Vox Solaris Standing each");
      expect(lineTitled(model, "Buy Gyromag Systems").cost).toBe("1K Vox Solaris Standing");
      expect(earnOf(model, "Vox Solaris Standing").count?.need).toBe(84_500);
    });

    it("banks the Baruuk Vox Solaris standing with no chip restating the blueprints", () => {
      const line = earnOf(steps("Baruuk"), "Vox Solaris Standing");
      expect(chips(line)).toEqual([]);
      expect(line.count?.need).toBe(94_500);
    });
  });
});

describe("a quest's rewards", () => {
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  function unique(name: string, pattern = /./): string {
    const found = Object.entries(db).find(
      ([key, entry]) => entry.name === name && pattern.test(key),
    );
    if (!found) throw new Error(`no item named ${name}`);
    return found[0];
  }

  function steps(name: string, inventory: RawInventoryData | null = null): PlanModel {
    const plan = authoredPlan(name);
    if (!plan) throw new Error(`no plan for ${name}`);
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory, now: NOW }, null, {
      uniqueName: name,
      parts,
    });
    return planSteps(resolved, { t });
  }

  const all = (model: PlanModel): PlanLine[] => [...open(model), ...model.done];
  const chips = (entry: PlanLine): string[] => entry.parts.map((part) => part.label);
  const shrine = (model: PlanModel): PlanLine => lineTitled(model, "Do The Silver Grove");
  const APOTHICS = [
    "Nightfall Apothic Blueprint",
    "Twilight Apothic Blueprint",
    "Sunrise Apothic Blueprint",
  ];
  const questDone = (): RawInventoryData =>
    ({
      QuestKeys: [{ ItemType: unique("The Silver Grove", /KeyChain/), Completed: true }],
    }) as unknown as RawInventoryData;

  it("puts every blueprint a quest hands over on the plan's own step for that quest", () => {
    const model = steps("Titania");
    expect(chips(shrine(model))).toEqual(expect.arrayContaining(APOTHICS));
    expect(all(model).some((entry) => /Apothic Blueprint/.test(entry.title))).toBe(false);
    expect(all(model).some((entry) => /quests/i.test(entry.tag))).toBe(false);
  });

  it("keeps the step open while the quest is still to do", () => {
    const line = shrine(steps("Titania", {}));
    expect(line.done).toBe(false);
    expect(
      line.parts.filter((part) => APOTHICS.includes(part.label)).map((part) => part.done),
    ).toEqual([false, false, false]);
  });

  it("settles the step once the quest is done", () => {
    expect(shrine(steps("Titania", questDone())).done).toBe(true);
  });

  it("ticks each blueprint already held and leaves the step open for the rest", () => {
    const inventory = {
      Recipes: [{ ItemType: unique("Nightfall Apothic Blueprint"), ItemCount: 1 }],
    } as unknown as RawInventoryData;
    const line = shrine(steps("Titania", inventory));
    const done = Object.fromEntries(line.parts.map((part) => [part.label, part.done]));
    expect(done).toMatchObject({
      "Nightfall Apothic Blueprint": true,
      "Twilight Apothic Blueprint": false,
      "Sunrise Apothic Blueprint": false,
    });
    expect(line.done).toBe(false);
  });

  it("puts an uncrafted quest reward on the quest's step as itself", () => {
    const model = steps("Octavia");
    expect(chips(lineTitled(model, "Do Octavia's Anthem"))).toContain("Mandachord");
    expect(all(model).some((entry) => entry.title === "Mandachord")).toBe(false);
  });

  describe("with no step of the plan's own for the quest", () => {
    const KEY = "/Lotus/Types/Keys/TestGrove/TestGroveKeyChainItem";
    const TONICS = { Alpha: "/Test/AlphaTonic", Beta: "/Test/BetaTonic" };
    const DB_OWN: Record<string, ItemDbEntry> = {
      [KEY]: { name: "The Test Grove" },
      [TONICS.Alpha]: { name: "Alpha Tonic" },
      [TONICS.Beta]: { name: "Beta Tonic" },
      [`${TONICS.Alpha}Blueprint`]: { name: "Alpha Tonic Blueprint" },
      [`${TONICS.Beta}Blueprint`]: { name: "Beta Tonic Blueprint" },
    };
    const tonic = {
      kind: "craft",
      best: { place: "QUESTS", sub: "The Test Grove", activity: null, how: "quest reward" },
      recipe: [{ qty: 2, label: "Herb" }],
    };
    const store = resourceLookup({
      Herb: { kind: "farm", best: { place: "EARTH", sub: null, activity: "pick" } },
      "Alpha Tonic": tonic,
      "Beta Tonic": tonic,
    });
    const model = (inventory: RawInventoryData | null): PlanModel =>
      planSteps(
        fixture(
          [],
          {
            materials: [
              { qty: "1", label: "Alpha Tonic", note: null },
              { qty: "1", label: "Beta Tonic", note: null },
            ],
          },
          { resources: store, itemDb: DB_OWN, inventory },
        ),
        { t },
      );
    const quest = (inventory: RawInventoryData | null = null): PlanLine =>
      lineTitled(model(inventory), "Do The Test Grove");
    const recipes = (...keys: string[]) =>
      ({
        Recipes: keys.map((ItemType) => ({ ItemType, ItemCount: 1 })),
      }) as unknown as RawInventoryData;

    it("leads Get with one step for the quest, holding both blueprints and no bare place", () => {
      const steps = model(null);
      const line = lineTitled(steps, "Do The Test Grove");
      expect(line).toMatchObject({ section: "get", kind: "quest", tag: "", done: false });
      expect(chips(line)).toEqual(["Alpha Tonic Blueprint", "Beta Tonic Blueprint"]);
      expect(steps.sections[0].entries[0]).toBe(line);
      expect(lineTitled(steps, "Refine Alpha Tonic").section).toBe("build");
    });

    it("stays open while one blueprint is still to get", () => {
      const line = quest(recipes(`${TONICS.Alpha}Blueprint`));
      expect(line.parts.map((part) => part.done)).toEqual([true, false]);
      expect(line.done).toBe(false);
    });

    it("settles once every blueprint is held", () => {
      expect(quest(recipes(`${TONICS.Alpha}Blueprint`, `${TONICS.Beta}Blueprint`)).done).toBe(true);
    });

    it("settles once the quest is done", () => {
      const inventory = {
        QuestKeys: [{ ItemType: KEY, Completed: true }],
      } as unknown as RawInventoryData;
      expect(quest(inventory).done).toBe(true);
    });
  });
});

describe("an earn line", () => {
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  function steps(name: string): PlanModel {
    const plan = authoredPlan(name);
    if (!plan) throw new Error(`no plan for ${name}`);
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory: null, now: NOW }, null, {
      uniqueName: name,
      parts,
    });
    return planSteps(resolved, { t });
  }

  const KUVA_1K: PlanCurrency[] = [{ currency: "Kuva", amount: "1,000" }];
  const vendor = (): PlanGroup => ({
    ...group("vendor", "NAKAK", "buy it", [row("Thing", KUVA_1K)]),
    spends: KUVA_1K,
  });
  const earner = (): PlanGroup => ({
    ...group("currency", "KUVA FLOOD NODE", "Kuva Flood", [row("Kuva")]),
    earns: { currency: "Kuva", amount: "1,000" },
  });
  const kuva = (groups: PlanGroup[]): PlanLine =>
    lineTitled(planSteps(fixture(groups), { t }), "Earn Kuva");

  it("tags the line with how the currency banks, then where", () => {
    expect(kuva([earner(), vendor()]).tag).toBe("Kuva Flood, Kuva Flood Node");
    expect(lineTitled(steps("Aegrit"), "Earn Stock").tag).toBe(
      "Break Narmer weekly mission, Drifter's Camp, Earth",
    );
  });

  it("leaves out an activity that only restates the title", () => {
    expect(lineTitled(steps("Mara Detron"), "Earn Orokin Ducats").tag).toBe("Void Fissures, Any");
    expect(lineTitled(steps("Aegrit"), "Earn Kuva").tag).toBe("Any Kuva Siphon, Flood Or Relic");
  });

  it("reads the same whether the plan authors it or the store supplies it", () => {
    const pick = (entry: PlanLine) => ({
      kind: entry.kind,
      section: entry.section,
      title: entry.title,
      tag: entry.tag,
      count: entry.count,
      place: entry.place,
      wiki: entry.drawer.wiki,
    });
    expect(pick(kuva([vendor()]))).toEqual(pick(kuva([earner(), vendor()])));
  });

  it("joins a supplied earn line to the trip at its place", () => {
    const model = steps("Ironbride");
    const trip = model.sections
      .flatMap((section) => section.entries)
      .find((entry) => entry.kind === "trip" && entry.place === "Cambion Drift, Deimos");
    const titles = trip?.kind === "trip" ? trip.lines.map((entry) => entry.title) : [];
    expect(titles).toEqual(
      expect.arrayContaining(["Mother, Isolation Vaults", "Earn Entrati Standing"]),
    );
  });
});

describe("a rank-up's sacrifice that drops on a trip", () => {
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  const model = (): PlanModel => {
    const plan = authoredPlan("Ironbride");
    if (!plan) throw new Error("no plan for Ironbride");
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory: null, now: NOW }, null, {
      uniqueName: "Ironbride",
      parts,
    });
    return planSteps(resolved, { t });
  };
  const MATRICES = [
    "Orokin Orientation Matrix",
    "Orokin Ballistics Matrix",
    "Orokin Animus Matrix",
  ];

  it("stays a pickup on the line it drops from", () => {
    const vault = lineTitled(model(), "Mother, Isolation Vaults");
    expect(vault.parts.map((part) => part.label)).toEqual(MATRICES);
  });

  it("is named once on the rank-up that takes it", () => {
    const parts = open(model()).flatMap((entry) => entry.drawer.parts);
    const note = (label: string) => parts.find((part) => part.label === label)?.note ?? "";
    expect(note("Clearance: Agnesis")).toBe(
      "Zymos Barrel Blueprint, 20 Father Tokens, 150 Void Traces; 10 Orokin Orientation Matrix",
    );
    for (const [rank, matrix] of [
      ["Clearance: Modus", "Ballistics Matrix"],
      ["Clearance: Odima", "Animus Matrix"],
    ]) {
      expect(note(rank).split(matrix).length - 1).toBe(1);
    }
  });
});

describe("an alias of Credits", () => {
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  const texts = (model: PlanModel): string[] =>
    [...open(model), ...model.done].flatMap((entry) => [
      entry.title,
      entry.tag,
      entry.cost ?? "",
      ...entry.parts.map((part) => `${part.label} ${part.cost ?? ""}`),
      ...entry.chips.map((chip) => chip.title),
      ...entry.drawer.parts.map((part) => part.cost ?? ""),
    ]);

  it("is dropped from a price and never farmed, the way Credits are", () => {
    const price: PlanCurrency[] = [
      { currency: "Ostron Standing", amount: "1,000" },
      { currency: "Höllars", amount: "5,000" },
    ];
    const shop = {
      ...group("vendor", "CETUS, EARTH", "buy it", [row("Thing", price)]),
      spends: price,
    };
    const model = planSteps(fixture([shop]), { t });
    expect(lineTitled(model, "Buy Thing").cost).toBe("1K Ostron Standing");
    expect(texts(model).some((text) => /h[öo]llars|credits/i.test(text))).toBe(false);
  });

  it.each(["AX-52", "Reconifex"])("shows nowhere on %s", (name) => {
    const plan = authoredPlan(name);
    if (!plan) throw new Error(`no plan for ${name}`);
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory: null, now: NOW }, null, {
      uniqueName: name,
      parts,
    });
    expect(texts(planSteps(resolved, { t })).some((text) => /h[öo]llars/i.test(text))).toBe(false);
  });
});

describe("a group a quest pays out", () => {
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  function unique(name: string, pattern = /./): string {
    const found = Object.entries(db).find(
      ([key, entry]) => entry.name === name && pattern.test(key),
    );
    if (!found) throw new Error(`no item named ${name}`);
    return found[0];
  }

  function steps(name: string, inventory: RawInventoryData | null = null): PlanModel {
    const plan = authoredPlan(name);
    if (!plan) throw new Error(`no plan for ${name}`);
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory, now: NOW }, null, {
      uniqueName: name,
      parts,
    });
    return planSteps(resolved, { t });
  }

  const all = (model: PlanModel): PlanLine[] => [...open(model), ...model.done];
  const saya = (inventory: RawInventoryData | null = null): PlanLine =>
    lineTitled(steps("Gara", inventory), "Do Saya's Vigil");

  it("leads Get as Do <quest>, its pickup named in full, tagged where the quest runs", () => {
    const model = steps("Gara");
    const line = saya();
    expect(model.sections[0].entries[0]).toBe(lineTitled(model, "Do Saya's Vigil"));
    expect(line).toMatchObject({ kind: "quest", section: "get", tag: "Cetus, Earth" });
    expect(line.parts.map((part) => part.label)).toEqual(["Gara Blueprint"]);
    expect(all(model).some((entry) => entry.title === "Konzu, then Saya")).toBe(false);
  });

  it("keeps the group's where and activity in its drawer, with the pickup's note", () => {
    const { drawer } = saya();
    expect(drawer.where).toBe("Cetus, Earth, Konzu, then Saya");
    expect(drawer.rates).toContain("finish the quest");
    expect(drawer.parts).toMatchObject([{ label: "Gara Blueprint", note: "quest reward" }]);
    expect(drawer.wiki).toContain("Saya's_Vigil");
  });

  it("stays open while the quest is still to do and the pickup is not held", () => {
    expect(saya({}).done).toBe(false);
  });

  it("settles once the quest is done", () => {
    const inventory = {
      QuestKeys: [{ ItemType: unique("Saya's Vigil", /KeyChain/), Completed: true }],
    } as unknown as RawInventoryData;
    expect(saya(inventory).done).toBe(true);
  });

  it("is one step per quest: every group the quest pays out folds into it", () => {
    const model = steps("Chroma");
    expect(all(model).filter((entry) => entry.title === "Do The New Strange")).toHaveLength(1);
    expect(all(model).some((entry) => entry.title === "Uranus, Neptune, Pluto")).toBe(false);
  });

  it("leaves a group that is no drop as its own step, ahead where the plan puts it", () => {
    const model = steps("Inaros");
    const get = model.sections[0].entries.map((entry) =>
      entry.kind === "trip" ? "" : entry.title,
    );
    expect(get.indexOf("Buy Sands of Inaros Blueprint")).toBeLessThan(
      get.indexOf("Do Sands of Inaros"),
    );
  });

  it("takes the quest's other pickups onto the same step, chips and drawer alike", () => {
    const line = lineTitled(steps("Titania"), "Do The Silver Grove");
    const drawn = line.drawer.parts.map((part) => part.label);
    expect(drawn).toEqual(expect.arrayContaining(line.parts.map((part) => part.label)));
    expect(drawn).toContain("Nightfall Apothic Blueprint");
  });
});

describe("a store material bought at a vendor", () => {
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  const gara = (): PlanModel => {
    const plan = authoredPlan("Gara");
    if (!plan) throw new Error("no plan for Gara");
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory: null, now: NOW }, null, {
      uniqueName: "Gara",
      parts,
    });
    return planSteps(resolved, { t });
  };

  const OSTRON_500 = [{ currency: "Ostron Standing", amount: "500" }];
  const store = resourceLookup({
    Cutter: {
      kind: "farm",
      best: {
        place: "CETUS, EARTH",
        sub: "Suumbaat",
        activity: "buy",
        buy: { price: OSTRON_500, reusable: true },
      },
    },
    Gland: {
      kind: "farm",
      best: { place: "NECRALISK, DEIMOS", sub: "Son", activity: "buy", buy: { price: OSTRON_500 } },
    },
    Ore: { kind: "farm", best: { place: "CETUS, EARTH", sub: null, activity: "mine" } },
  });
  const model = (qty: string, label: string): PlanModel =>
    planSteps(
      fixture([], { materials: [{ qty, label, note: `${label} note` }] }, { resources: store }),
      { t },
    );

  it("buys a reusable tool once in Get, at its price and no count", () => {
    const line = lineTitled(model("1", "Cutter"), "Buy Cutter");
    expect(line).toMatchObject({ kind: "buy", section: "get", cost: "500 Ostron Standing" });
    expect(line.count).toBeNull();
    expect(line.drawer.notes).toContain("Cutter note");
  });

  it("buys a single unit at its bare price", () => {
    expect(lineTitled(model("1", "Gland"), "Buy Gland").cost).toBe("500 Ostron Standing");
  });

  it("counts and prices each unit when more than one is bought", () => {
    const line = lineTitled(model("3", "Gland"), "Buy Gland");
    expect(line).toMatchObject({ cost: "500 Ostron Standing each", count: { need: 3 } });
  });

  it("keeps a material with no price a farm line", () => {
    expect(lineTitled(model("5", "Ore"), "Ore")).toMatchObject({
      kind: "material",
      section: "farm",
    });
  });

  it("never farms the tool, and its standing still counts toward the earn line", () => {
    const steps = gara();
    expect(lineTitled(steps, "Buy Nosam Cutter").cost).toBe("500 Ostron Standing");
    expect(open(steps).some((entry) => entry.title === "Nosam Cutter")).toBe(false);
    expect(lineTitled(steps, "Earn Ostron Standing").count?.need).toBe(6_000);
  });
});

describe("a price", () => {
  const vendor = (currency: string, amount: string): PlanLine => {
    const price = [{ currency, amount }];
    const shop = { ...group("vendor", "RELAY", "buy it", [row("Thing", price)]), spends: price };
    return lineTitled(planSteps(fixture([shop]), { t }), "Buy Thing");
  };

  it("names the standing that pays it", () => {
    expect(vendor("Cephalon Simaris Standing", "50,000").cost).toBe(
      "50K Cephalon Simaris Standing",
    );
    expect(vendor("Ostron Standing", "2,500").cost).toBe("2.5K Ostron Standing");
  });

  it("names any other currency the same way", () => {
    expect(vendor("Live Heartcell", "10").cost).toBe("10 Live Heartcell");
  });
});

describe("a chipped row's facts", () => {
  const drop = (rows: PlanRow[]): PlanLine =>
    lineTitled(
      planSteps(fixture([group("farm", "FOSSA, VENUS", "Assassination", rows)]), { t }),
      "Assassination",
    );

  it("keeps every chip's note in the drawer, the chip still on the line", () => {
    const line = drop([row("Neuroptics Blueprint"), row("Chassis Blueprint")]);
    expect(line.parts.map((part) => part.label)).toEqual([
      "Neuroptics Blueprint",
      "Chassis Blueprint",
    ]);
    expect(line.drawer.parts.map((part) => [part.label, part.note])).toEqual([
      ["Neuroptics Blueprint", "Neuroptics Blueprint note"],
      ["Chassis Blueprint", "Chassis Blueprint note"],
    ]);
  });

  it("keeps a chip's done state and count in the drawer", () => {
    const line = drop([
      { ...row("Neuroptics Blueprint"), done: true },
      { ...row("Lens"), qty: "3" },
    ]);
    expect(line.drawer.parts).toMatchObject([
      { label: "Neuroptics Blueprint", done: true },
      { label: "Lens", done: false, count: { need: 3 } },
    ]);
  });

  it("keeps an earn line's chips in its drawer", () => {
    const db = (() => {
      itemDatabase.buildDatabase();
      return itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
    })();
    const plan = authoredPlan("Bhaira Hound");
    if (!plan) throw new Error("no plan for Bhaira Hound");
    const parts = { known: false, copies: 1 } as PartPlan;
    const resolved = resolvePlan(plan, { itemDb: db, inventory: null, now: NOW }, null, {
      uniqueName: "Bhaira Hound",
      parts,
    });
    const line = lineTitled(planSteps(resolved, { t }), "Earn Solaris United Standing");
    const drawn = line.drawer.parts.map((part) => part.label);
    expect(line.parts.length).toBeGreaterThan(0);
    expect(drawn).toEqual(expect.arrayContaining(line.parts.map((part) => part.label)));
  });
});

describe("a place name", () => {
  const tag = (place: string): string =>
    lineTitled(planSteps(fixture([group("farm", place, "Hunt", [row("Lens")])]), { t }), "Hunt")
      .tag;

  it.each([
    ["PLAINS OF EIDOLON, EARTH", "Plains of Eidolon, Earth"],
    ["THE QUILLS, CETUS", "The Quills, Cetus"],
    ["MINERVA, THE ROUND TABLE", "Minerva, The Round Table"],
    ["RELAY, RED VEIL AND NEW LOKA", "Relay, Red Veil and New Loka"],
    ["BARO KI'TEER, RELAY", "Baro Ki'teer, Relay"],
    ["LA CATHÉDRALE, SANCTUM ANATOMICA", "La Cathédrale, Sanctum Anatomica"],
    ["BIRD 3, SANCTUM ANATOMICA", "Bird 3, Sanctum Anatomica"],
  ])("reads %s as %s", (place, expected) => {
    expect(tag(place)).toBe(expected);
  });
});
