import { describe, expect, it } from "vitest";

import { partLeaf, planOnlyParts } from "../../../src/components/nextup/acquisitionParts.js";
import {
  displayOrder,
  planSteps,
  type PlanStep,
} from "../../../src/components/nextup/plan/planSteps.js";
import { en } from "../../../src/i18n/en.js";
import { resolveAcquisition } from "../../../src/lib/suggest/acquisition/index.js";
import { frame, part } from "../lib/suggest/acquisition/fixtures.js";
import {
  resolvePlan,
  resolvePlanFor,
  type ResolvedPlan,
} from "../../../src/lib/suggest/acquisition/plan/index.js";
import { planGroup } from "../../../src/lib/suggest/acquisition/plan/materials.js";
import type { Translator } from "../../../src/lib/i18n.js";
import type { CraftingTreeNode } from "../../../src/lib/craftingTree.js";
import type { AuthoredPlan } from "../../../src/lib/suggest/acquisition/plan/index.js";
import type { ItemDbEntry, RawInventoryData } from "../../../src/types/inventory.js";
import type { RelicDatabase } from "../../../src/types/relics.js";

const t: Translator = (key, params = {}) =>
  (en[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

const NOW = Date.parse("2026-10-10T00:00:00Z");
const VOX_SOLARIS = "/Lotus/Types/Keys/SolarisQuest/SolarisQuestKeyChain";

const DB: Record<string, ItemDbEntry> = {
  [VOX_SOLARIS]: { name: "Vox Solaris", category: "Key" },
};

function player(standing: number): RawInventoryData {
  return {
    QuestKeys: [{ ItemType: VOX_SOLARIS, Completed: true }],
    Affiliations: [{ Tag: "VentKidsSyndicate", Standing: standing, Title: 0 }],
  };
}

function shipped(name: string, inventory: RawInventoryData | null): ResolvedPlan {
  const plan = resolvePlanFor({ name, tier: null }, { itemDb: DB, inventory, now: NOW });
  if (!plan) throw new Error(`no plan for ${name}`);
  return plan;
}

/** The authored steps, without the material farms the store slots in. */
function authored(steps: PlanStep[]): PlanStep[] {
  return steps.filter((step) => !step.id.startsWith("m"));
}

describe("acquisition steps", () => {
  it("walks Bad Baby in order with what the player holds", () => {
    const steps = authored(planSteps(shipped("Bad Baby", player(3_000)), { t }));
    expect(steps.map((step) => step.title)).toEqual([
      "Earn Ventkids Standing",
      "Buy at Roky, Fortuna",
      "Build 4 parts in the foundry",
      "Assemble K-Drive, Roky, Fortuna",
    ]);
    const [earn, buy] = steps;
    expect(earn.where).toBe("Orb Vallis, Venus: K-Drive races and trick chains");
    expect(earn.state).toEqual({ kind: "count", have: 3_000, need: 20_000, label: null });
    expect(earn.rows).toEqual([]);
    expect(buy.rows.map((row) => [row.label, row.value])).toEqual([
      ["Bad Baby Blueprint", "5K standing"],
      ["Coldfusor, Beaky, Twin Kavats", "5K standing each"],
    ]);
    expect(buy.disclosures.map((entry) => entry.title)).toEqual(["the other parts Roky sells"]);
  });

  it("reads a standing the player never earned as none held", () => {
    const steps = planSteps(shipped("Bad Baby", { QuestKeys: [] }), { t });
    const earn = steps.find((step) => step.title === "Earn Ventkids Standing");
    expect(earn?.state).toMatchObject({ have: 0, need: 20_000 });
    const unread = planSteps(shipped("Bad Baby", null), { t });
    expect(unread.find((step) => step.id === earn?.id)?.state).toMatchObject({ have: null });
  });

  it("puts the standing farm ahead of the vendor it pays for", () => {
    const plan = shipped("Feverspine", null);
    const authoredOrder = plan.groups.map((group) => group.type);
    expect(authoredOrder.indexOf("vendor")).toBeLessThan(authoredOrder.indexOf("currency"));
    const shown = displayOrder(plan.groups).map((group) => group.type);
    expect(shown.indexOf("currency")).toBeLessThan(shown.indexOf("vendor"));
    const steps = authored(planSteps(plan, { t }));
    expect(steps.map((step) => step.title)).toEqual([
      'Finish the race "Dead Drop", Cambion Drift, Deimos',
      "Earn Ventkids Standing",
      "Buy at Roky, Fortuna",
      "Build 4 parts in the foundry",
      "Assemble K-Drive, Roky, Fortuna",
    ]);
    const race = steps[0];
    expect(race.where).toBe("Grandmother's K-Drive races");
    expect(race.tags).toContain("on rotation some days");
    expect(race.disclosures.map((entry) => entry.title)).toEqual([
      "the Infested reactor, nose and jet",
    ]);
    expect(steps[2].rows).toEqual([
      expect.objectContaining({
        label: "Coldfusor, Beaky, Twin Kavats",
        value: "5K standing each",
      }),
    ]);
  });

  it("keeps a finished step listed and marks it done", () => {
    const plan = resolvePlanFor(
      { name: "Bad Baby", tier: null },
      { itemDb: DB, inventory: player(0), now: NOW, manualDone: ["1:0"] },
    );
    if (!plan) throw new Error("no plan for Bad Baby");
    const steps = planSteps(plan, { t });
    expect(steps[0]).toMatchObject({ title: "Earn Ventkids Standing", done: true });
    expect(steps.filter((step) => !step.done).length).toBeGreaterThan(0);
  });

  it("calls a rank-up pick still ahead its reward and a spent one its price", () => {
    const plan = (title: number) =>
      resolvePlan(pickPlan(), {
        itemDb: {},
        inventory: { Affiliations: [{ Tag: "VentKidsSyndicate", Standing: 0, Title: title }] },
        now: NOW,
      });
    const boardRow = (resolved: ResolvedPlan) =>
      planSteps(resolved, { t })
        .flatMap((step) => step.rows)
        .find((row) => row.label === "Board Blueprint");
    expect(boardRow(plan(1))).toMatchObject({ value: "Rank Up Reward", pick: "reward" });
    expect(boardRow(plan(2))).toMatchObject({ value: "10K standing", pick: "spent" });
  });

  it("says materials ready on the build step once nothing is short", () => {
    const plan = pickPlan();
    const resolved = resolvePlan(
      { ...plan, groups: [...plan.groups, planGroup("foundry", "FOUNDRY", [row("Board")])] },
      { itemDb: {}, inventory: null, now: NOW },
    );
    const build = (buildable: boolean) =>
      planSteps(resolved, { t, buildable }).find((step) => step.title === "Build Board");
    expect(build(true)?.state).toEqual({ kind: "ready" });
    expect(build(false)?.state).toBeNull();
  });

  it("lists every material Flatbelly buys from Smokefinger with its blueprint's price", () => {
    const steps = planSteps(shipped("Flatbelly", null), { t });
    const vendor = steps.filter((step) => step.title.includes("Smokefinger"));
    expect(vendor.map((step) => step.title)).toEqual([
      "Buy blueprints and craft, Smokefinger, Fortuna",
    ]);
    expect(
      vendor[0].rows.map((entry) => [entry.label, entry.value, entry.tags.map((tag) => tag.text)]),
    ).toEqual([
      ["Venerdo Alloy", "40", ["BP 2K standing"]],
      ["Travocyte Alloy", "65", ["BP 1K standing"]],
      ["Star Amarast", "5", ["BP 4K standing"]],
      ["Heart Noctrul", "15", ["BP 1K standing"]],
    ]);
  });

  it("reads an owned reusable blueprint as done and never tags a rank", () => {
    const VENERDO_BP = "/Lotus/Types/Recipes/Test/VenerdoAlloyBlueprint";
    const resolved = resolvePlanFor(
      { name: "Flatbelly", tier: null },
      {
        itemDb: { ...DB, [VENERDO_BP]: { name: "Venerdo Alloy Blueprint" } },
        inventory: {
          ...player(0),
          Affiliations: [{ Tag: "SolarisSyndicate", Standing: 0, Title: 0 }],
          Recipes: [{ ItemType: VENERDO_BP, ItemCount: 1 }],
        },
        now: NOW,
      },
    );
    if (!resolved) throw new Error("no Flatbelly plan");
    const rows = planSteps(resolved, { t }).flatMap((step) => step.rows);
    const tags = (label: string) => rows.find((entry) => entry.label === label)?.tags;
    expect(tags("Venerdo Alloy")).toEqual([{ text: "BP done", tone: "done" }]);
    expect(tags("Star Amarast")).toEqual([{ text: "BP 4K standing", tone: null }]);
  });

  it("names the row a lone step's count belongs to", () => {
    const NEURODES = "/Lotus/Types/Items/MiscItems/Neurode";
    const plan: AuthoredPlan = {
      ...pickPlan(),
      groups: [
        planGroup("farm", "EARTH", [{ ...row("Neurodes"), qty: "4" }], { activity: "Survival" }),
      ],
    };
    const resolved = resolvePlan(plan, {
      itemDb: { [NEURODES]: { name: "Neurodes" } },
      inventory: { MiscItems: [{ ItemType: NEURODES, ItemCount: 1 }] },
      now: NOW,
    });
    const [step] = planSteps(resolved, { t });
    expect(step.title).toBe("Survival, Earth");
    expect(step.rows).toEqual([]);
    expect(step.state).toEqual({ kind: "count", have: 1, need: 4, label: "Neurodes" });
  });
});

function row(label: string, note: string | null = null) {
  return { qty: null, label, note, alt: null, done: false };
}

function pickPlan(): AuthoredPlan {
  return {
    name: "Board",
    kind: "kdrive",
    source: "standing",
    effort: 3,
    tradeable: false,
    progress: { have: 0, need: 2, unit: "parts" },
    badges: [],
    prices: [],
    groups: [
      planGroup(
        "vendor",
        "ROKY",
        [
          {
            ...row("Board Blueprint"),
            pick: {
              rank: { syndicate: "Ventkids", level: 2 },
              spends: [{ currency: "Ventkids Standing", amount: "10,000" }],
            },
          },
          {
            ...row("Jet Blueprint"),
            buy: { price: [{ currency: "Ventkids Standing", amount: "5,000" }] },
          },
        ],
        { spends: [{ currency: "Ventkids Standing", amount: "5,000" }] },
      ),
    ],
  };
}

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

describe("acquisition steps for a Prime", () => {
  it("draws its generated plan through the same steps", () => {
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
    expect(plan).not.toBeNull();
    const steps = planSteps(plan as ResolvedPlan, { t });
    expect(steps.length).toBeGreaterThan(1);
    expect(steps[steps.length - 1]?.title).toBe(`Build ${PRIME}`);
    expect(steps.some((step) => step.title.includes("Any Void Fissure"))).toBe(true);
  });
});

describe("acquisition parts", () => {
  const BOARD = "/Lotus/Types/Vehicles/Hoverboard/HoverboardSolarisADeck";
  const REACTOR = "/Lotus/Types/Vehicles/Hoverboard/HoverboardSolarisAEngine";

  function node(name: string, children: CraftingTreeNode[] = []): CraftingTreeNode {
    return { ...partLeaf({ name, uniqueName: name, done: false }), children };
  }

  it("adds the parts the plan's foundry builds that the recipe never names", () => {
    const tree = {
      ...node("Bad Baby", [node("Thermal Sludge"), node("Scrap")]),
      uniqueName: BOARD,
    };
    const db: Record<string, ItemDbEntry> = {
      [REACTOR]: {
        name: "Coldfusor",
        recipe: { buildPrice: 5_000, buildTime: 3_600, num: 1, ingredients: [] },
      },
      [`${REACTOR}Blueprint`]: { name: "Coldfusor", buildsProduct: REACTOR },
    };
    const extras = planOnlyParts(shipped("Bad Baby", null), tree, db);
    expect(extras).toEqual([
      { name: "Coldfusor", uniqueName: REACTOR, done: false },
      { name: "Beaky", uniqueName: null, done: false },
      { name: "Twin Kavats", uniqueName: null, done: false },
    ]);
    expect(partLeaf(extras[1])).toMatchObject({ count: 1, owned: 0, missing: 1, children: [] });
  });

  it("adds nothing when the recipe already names every part", () => {
    const tree = node("Bad Baby", [node("Coldfusor"), node("Beaky"), node("Twin Kavats")]);
    expect(planOnlyParts(shipped("Bad Baby", null), tree, {})).toEqual([]);
    expect(planOnlyParts(null, tree, {})).toEqual([]);
  });
});
