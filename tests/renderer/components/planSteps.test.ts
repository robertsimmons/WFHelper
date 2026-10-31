import { beforeAll, describe, expect, it } from "vitest";

import {
  planSteps,
  stepProgress,
  type PlanLine,
  type PlanModel,
} from "../../../src/components/nextup/plan/planSteps.js";
import * as itemDatabase from "../../../services/itemDatabase";
import { farmNeed } from "../../../src/lib/suggest/acquisition/shops/picker.js";
import { en } from "../../../src/i18n/en.js";
import { resolveAcquisition } from "../../../src/lib/suggest/acquisition/index.js";
import { frame, part } from "../lib/suggest/acquisition/fixtures.js";
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

const DB: Record<string, ItemDbEntry> = {
  [CRIMSON]: { name: "Crimson Talent" },
  [EMERALD]: { name: "Emerald Talent" },
  [SIRIUS_NEURO]: { name: "Sirius & Orion Neuroptics Blueprint" },
  [WRATH]: { name: "Wrath" },
  [CAPILLARIES]: { name: "Vessel Capillaries" },
  [DANTE_NEURO]: { name: "Dante Neuroptics Blueprint" },
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
    expect(basics.chips.map((chip) => chip.title)).toEqual(
      expect.arrayContaining(["Polymer Bundle", "Orokin Cell", "Credits"]),
    );
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
    const plains = trips.find((entry) => entry.place === "Plains Of Eidolon, Earth");
    expect(plains?.kind === "trip" && plains.lines.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(["Konzu", "Grokdrul", "Cetus Wisp"]),
    );
    const sepulcrum = planSteps(shipped("Sepulcrum"), { t });
    const lone = sepulcrum.sections[1].entries.find(
      (entry) => entry.kind !== "trip" && entry.title === "Travoride",
    );
    expect(lone).toBeDefined();
  });

  it("buys a crafted material's blueprint in Get and farms the material in Farm", () => {
    const model = planSteps(shipped("Sepulcrum"), { t });
    const buy = lineTitled(model, "Buy Coprite Alloy Blueprint");
    expect(buy).toMatchObject({ section: "get", rowIds: [] });
    expect(lineTitled(model, "Coprite Alloy").section).toBe("farm");
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

  it("files a ticked line under done and moves next on, and the counter follows", () => {
    const before = planSteps(shipped("Bad Baby"), { t });
    const first = open(before).find((entry) => entry.next);
    expect(first?.title).toBe("Buy blueprints at Roky");
    const after = planSteps(shipped("Bad Baby", { manualDone: first?.rowIds ?? [] }), { t });
    // Every blueprint bought leaves no Ventkids standing owed, so that banks too.
    expect(after.done.map((entry) => entry.title)).toEqual([
      "Buy blueprints at Roky",
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
    expect(lineTitled(model, "Buy at Hunhow").section).toBe("get");
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
    expect(lineTitled(model, "Buy at Hunhow").blocked).toBe(true);
    expect(lineTitled(model, "Scoria's Angel").count).toEqual({
      have: 100,
      need: farmNeed(totals, "Crimson Talent"),
    });
    expect(open(model).find((entry) => entry.next)?.title).not.toBe("Buy at Hunhow");

    const rich = stocked("Sirius & Orion", {
      inventory: talent(5_000, 5_000, { Melee: [{ ItemType: WRATH }] }),
      shopPicks: { hunhow: flipped },
    });
    expect(lineTitled(planSteps(rich, { t }), "Buy at Hunhow").blocked).toBe(false);
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
    expect(get.map((entry) => (entry as PlanLine).title)).toContain("Buy at Otak");
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
    const set = lineTitled(planSteps(hok([strikeIds[1]]), { t }), "Buy blueprints at Hok");
    expect(set.count).toEqual({ have: 1, need: 3 });
    expect(set.cost).toBe("1K standing each");
    expect(set.rowIds).toEqual(strikeIds);
    expect(set.drawer.parts.map((part) => [part.label, part.done, part.cost])).toEqual([
      ["Balla Strike Blueprint", false, null],
      ["Ooltha Strike Blueprint", true, null],
      ["Kronsh Strike Blueprint", false, null],
    ]);
  });

  it("totals the open parts and prices each in the drawer when prices differ", () => {
    const ranks = lineTitled(planSteps(hok(), { t }), "Buy at Hok");
    expect(ranks.count).toEqual({ have: 0, need: 2 });
    expect(ranks.cost).toBe("3K standing");
    expect(ranks.drawer.parts.map((part) => part.cost)).toEqual(["1K standing", "2K standing"]);
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
    expect(model.done.map((entry) => entry.title)).toEqual(["Buy blueprints at Hok"]);
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
    expect(build?.entries).toHaveLength(1);
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
