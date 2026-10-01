import { describe, expect, it } from "vitest";

import { inventory, itemDb } from "./fixtures.js";
import {
  fallbackPlan,
  resolvePlanFor,
  validatePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type { FallbackSource } from "../../../../../../src/lib/suggest/acquisition/plan/index.js";

function source(overrides: Partial<FallbackSource> = {}): FallbackSource {
  return {
    name: "Volt",
    kind: "warframe",
    tier: null,
    effort: 0.4,
    parts: {
      known: true,
      main: { name: "Volt Blueprint", required: 1, owned: 0, missing: 1 },
      components: [
        { name: "Volt Neuroptics", required: 1, owned: 0, missing: 1 },
        { name: "Volt Chassis", required: 1, owned: 1, missing: 0 },
      ],
      missing: [{ name: "Volt Neuroptics", required: 1, owned: 0, missing: 1 }],
      materials: [
        { name: "Alloy Plate", required: 150, owned: 100, missing: 50 },
        { name: "Rubedo", required: 1200, owned: 0, missing: 1200 },
      ],
      credits: 25000,
    },
    paths: [
      {
        kind: "quest",
        covers: ["Volt Neuroptics"],
        steps: [{ kind: "quest", where: "the Vor's Prize quest", parts: [] }],
      },
    ],
    ...overrides,
  };
}

describe("fallbackPlan", () => {
  it("satisfies the same schema as an authored plan", () => {
    expect(validatePlan(fallbackPlan(source()))).toEqual([]);
  });

  it("groups materials under the mission the resource table names", () => {
    const plan = fallbackPlan(source());
    const gabii = plan.groups.find((group) => group.place === "GABII, CERES");
    expect(gabii?.rows.map((row) => row.label)).toEqual(["Alloy Plate"]);
    expect(plan.groups.some((group) => group.rows.some((row) => row.label === "Rubedo"))).toBe(
      true,
    );
  });

  it("turns a path step into a group holding the parts it covers", () => {
    const plan = fallbackPlan(source());
    expect(plan.groups[0]).toMatchObject({ type: "gate", place: "THE VOR'S PRIZE QUEST" });
    expect(plan.groups[0].rows[0].label).toBe("Volt Neuroptics");
  });

  it("says it has no community notes rather than reading as bad", () => {
    const plan = fallbackPlan(source());
    expect(plan.badges).toEqual([{ text: "no community notes yet", tone: "info" }]);
  });

  it("stays sparse when there is nothing to say", () => {
    const bare = source({
      parts: { known: false, main: null, components: [], missing: [], materials: [], credits: 0 },
      paths: [],
    });
    const plan = fallbackPlan(bare);
    expect(plan.groups).toHaveLength(1);
    expect(plan.prices).toEqual([]);
  });
});

const LOKI_PARTS = ["Loki Neuroptics", "Loki Chassis", "Loki Systems"];

function loki(paths: FallbackSource["paths"]): FallbackSource {
  const counted = (name: string) => ({ name, required: 1, owned: 0, missing: 1 });
  return source({
    name: "Loki",
    parts: {
      known: true,
      main: counted("Loki Blueprint"),
      components: LOKI_PARTS.map(counted),
      missing: ["Loki Blueprint", ...LOKI_PARTS].map(counted),
      materials: [],
      credits: 25000,
    },
    paths,
  });
}

const LOKI_MARKET = {
  kind: "market",
  covers: ["Loki Blueprint"],
  steps: [{ kind: "market", where: "Market", parts: ["Loki Blueprint"] }],
};
const LOKI_BOSS = {
  kind: "boss",
  covers: LOKI_PARTS,
  steps: [{ kind: "boss", where: "Hyena Pack, Psamathe, Neptune", parts: LOKI_PARTS }],
};
const LOKI_TRADE = {
  kind: "trade",
  covers: ["Loki Blueprint", ...LOKI_PARTS],
  steps: [{ kind: "trade", where: "warframe.market", parts: ["Loki Blueprint", ...LOKI_PARTS] }],
  cost: { credits: null, plat: { set: 60, partsTotal: 70 } },
};
const LOKI_CIRCUIT = {
  kind: "circuit",
  covers: ["Loki Blueprint", ...LOKI_PARTS],
  steps: [{ kind: "circuit", where: "The Circuit, Duviri", parts: [] }],
};

function labelsAt(plan: ReturnType<typeof fallbackPlan>, place: string): string[] | undefined {
  return plan.groups.find((group) => group.place === place)?.rows.map((row) => row.label);
}

describe("fallbackPlan routes", () => {
  it("farms boss parts even when an easier path covers only the blueprint", () => {
    const plan = fallbackPlan(loki([LOKI_MARKET, LOKI_BOSS]));
    expect(labelsAt(plan, "MARKET")).toEqual(["Loki Blueprint"]);
    const boss = plan.groups.find((group) => group.place === "HYENA PACK, PSAMATHE, NEPTUNE");
    expect(boss?.type).toBe("boss");
    expect(labelsAt(plan, "HYENA PACK, PSAMATHE, NEPTUNE")).toEqual(LOKI_PARTS);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("buys only the blueprint at the Market and prices it once, in the head", () => {
    const market = {
      ...LOKI_MARKET,
      steps: [{ kind: "market", where: "Market (35,000 Credits)", parts: ["Loki Blueprint"] }],
      cost: { credits: 35_000, plat: null },
    };
    const bossAll = { ...LOKI_BOSS, covers: ["Loki Blueprint", ...LOKI_PARTS] };
    const plan = fallbackPlan(loki([bossAll, market]));
    expect(labelsAt(plan, "MARKET")).toEqual(["Loki Blueprint"]);
    expect(labelsAt(plan, "HYENA PACK, PSAMATHE, NEPTUNE")).toEqual(LOKI_PARTS);
    expect(plan.groups.some((group) => group.place.includes("CREDITS"))).toBe(false);
    expect(plan.prices).toEqual([{ label: "blueprint", amount: "35,000 cr", money: false }]);
  });

  it("reads trade as a price and the Circuit as a badge, never as the farm", () => {
    const plan = fallbackPlan(loki([LOKI_TRADE, LOKI_MARKET, LOKI_BOSS, LOKI_CIRCUIT]));
    expect(labelsAt(plan, "WARFRAME.MARKET")).toBeUndefined();
    expect(labelsAt(plan, "THE CIRCUIT, DUVIRI")).toBeUndefined();
    expect(labelsAt(plan, "HYENA PACK, PSAMATHE, NEPTUNE")).toEqual(LOKI_PARTS);
    expect(plan.prices).toEqual([{ label: "built", amount: "60 p", money: false }]);
    expect(plan.badges).toContainEqual({ text: "Circuit alt", tone: "circuit" });
  });

  it("falls back to trade when nothing else yields a part", () => {
    const plan = fallbackPlan(loki([LOKI_MARKET, LOKI_TRADE]));
    expect(labelsAt(plan, "WARFRAME.MARKET")).toEqual(LOKI_PARTS);
  });

  it("covers a quest blueprint that a partial junction path would otherwise hide", () => {
    const plan = fallbackPlan(
      loki([
        {
          kind: "junction",
          covers: LOKI_PARTS,
          steps: [{ kind: "junction", where: "Pluto Junction (on Neptune)", parts: LOKI_PARTS }],
        },
        {
          kind: "quest",
          covers: ["Loki Blueprint"],
          steps: [{ kind: "quest", where: "Some quest", parts: ["Loki Blueprint"] }],
        },
      ]),
    );
    expect(plan.groups.slice(0, 2).map((group) => group.place)).toEqual([
      "PLUTO JUNCTION (ON NEPTUNE)",
      "SOME QUEST",
    ]);
    expect(labelsAt(plan, "SOME QUEST")).toEqual(["Loki Blueprint"]);
  });

  it("keeps a harder route to the same parts behind a disclosure", () => {
    const mission = {
      kind: "mission",
      covers: LOKI_PARTS,
      steps: [{ kind: "mission", where: "Somewhere - Rotation C", parts: LOKI_PARTS }],
    };
    const plan = fallbackPlan(loki([LOKI_BOSS, mission]));
    const boss = plan.groups.find((group) => group.place === "HYENA PACK, PSAMATHE, NEPTUNE");
    expect(boss?.disclosures).toEqual([{ title: "also from", body: "Somewhere - Rotation C" }]);
    expect(labelsAt(plan, "SOMEWHERE - ROTATION C")).toBeUndefined();
  });

  it("walks a nemesis hunt as one group of ordered steps ending in the weapon", () => {
    const bare = {
      known: false,
      main: null,
      components: [],
      missing: [],
      materials: [],
      credits: 0,
    };
    const plan = fallbackPlan(
      source({
        name: "Kuva Bramma",
        parts: bare,
        paths: [
          {
            kind: "nemesis",
            covers: ["Kuva Bramma"],
            steps: [
              { kind: "nemesis", where: "Requires The War Within", parts: [] },
              { kind: "nemesis", where: "Stab the Kuva Lich", parts: [] },
            ],
          },
        ],
      }),
    );
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({ type: "boss", place: "NEMESIS HUNT" });
    expect(plan.groups[0].rows.map((row) => row.label)).toEqual([
      "Requires The War Within",
      "Stab the Kuva Lich",
      "Kuva Bramma",
    ]);
  });

  it("asks for the adapter itself on an Incarnon path", () => {
    const plan = fallbackPlan(
      source({
        name: "Braton",
        paths: [
          {
            kind: "circuit",
            covers: [],
            steps: [{ kind: "circuit", where: "Steel Path Circuit, week 3", parts: [] }],
          },
        ],
      }),
    );
    expect(labelsAt(plan, "STEEL PATH CIRCUIT, WEEK 3")).toEqual(["Braton Incarnon Genesis"]);
  });
});

describe("resolvePlanFor", () => {
  it("never reads as no route for Loki's boss-dropped parts", () => {
    const plan = resolvePlanFor(loki([LOKI_MARKET, LOKI_BOSS]), {
      itemDb: itemDb(),
      inventory: inventory(),
    });
    expect(plan.authored).toBe(false);
    const boss = plan.groups.find((group) => group.place === "HYENA PACK, PSAMATHE, NEPTUNE");
    expect(boss?.rows.map((row) => row.label)).toEqual(LOKI_PARTS);
  });

  it("uses the authored plan when there is one", () => {
    const plan = resolvePlanFor(source({ name: "Rhino" }), {
      itemDb: itemDb(),
      inventory: inventory(),
    });
    expect(plan.authored).toBe(true);
    expect(plan.effort).toBe(3);
  });

  it("marks a derived plan as not authored", () => {
    const unplanned = source({ name: "Unplanned Testframe" });
    const plan = resolvePlanFor(unplanned, { itemDb: itemDb(), inventory: inventory() });
    expect(plan.authored).toBe(false);
    expect(plan.effort).toBe(4);
    const gabii = plan.groups.find((group) => group.place === "GABII, CERES");
    expect(gabii?.rows[0].qty).toMatchObject({ required: 150, owned: 100, text: "50" });
  });

  it("takes the tier off the target, authored plan or not", () => {
    const context = { itemDb: itemDb(), inventory: inventory() };
    expect(resolvePlanFor(source({ name: "Rhino", tier: "C" }), context).tier).toBe("C");
    expect(resolvePlanFor(source({ tier: "C" }), context).tier).toBe("C");
    expect(resolvePlanFor(source({ name: "Rhino" }), context).tier).toBeNull();
  });

  it("lets a handed-in count win on a derived plan too", () => {
    const progress = { have: 3, need: 4, unit: "parts", ready: false };
    const plan = resolvePlanFor(source(), { itemDb: itemDb(), inventory: inventory(), progress });
    expect(plan.progress).toEqual({ ...progress, resolved: true });
  });
});
