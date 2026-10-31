// How a plan reads what the player owns: every balance through one reader, and
// every part, blueprint and build sized by the copies still to make. The item
// database is the real one and the plans are the shipped files.
import { beforeAll, describe, expect, it } from "vitest";

import * as itemDatabase from "../../../../../../services/itemDatabase";
import { aggregateComponentOwnership } from "../../../../../../config/shared/componentOwnership.js";
import { planSteps } from "../../../../../../src/components/nextup/plan/planSteps.js";
import { resolveAcquisition } from "../../../../../../src/lib/suggest/acquisition/index.js";
import { buildTotals } from "../../../../../../src/lib/suggest/acquisition/parts.js";
import { resolvePlanFor } from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import {
  balanceFor,
  readPlayerState,
} from "../../../../../../src/lib/suggest/acquisition/plan/state.js";
import { partsRead } from "../../../../../../src/lib/suggest/providers/acquisition.js";
import type { AcquisitionTarget } from "../../../../../../src/lib/suggest/acquisition/types.js";
import type { ResolvedPlan } from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type {
  ItemDbEntry,
  MasteryData,
  RawInventoryData,
} from "../../../../../../src/types/inventory.js";

const WR = "/Lotus/Types/Recipes/WarframeRecipes";
const ORAXIA = "/Lotus/Powersuits/Oraxia/Oraxia";
const GARA = "/Lotus/Powersuits/Glass/Glass";
const NOSAM_CUTTER = "/Lotus/Types/Restoratives/Consumable/MiningLaser";
const NOW = Date.UTC(2026, 9, 3);

let itemDb: Record<string, ItemDbEntry>;

beforeAll(() => {
  itemDatabase.buildDatabase();
  itemDb = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
});

interface Held {
  suits?: string[];
  recipes?: Record<string, number>;
  consumables?: Record<string, number>;
  standing?: Record<string, number>;
}

const stacks = (counts: Record<string, number> = {}) =>
  Object.entries(counts).map(([ItemType, ItemCount]) => ({ ItemType, ItemCount }));

function inventory(held: Held = {}): RawInventoryData {
  return {
    Suits: (held.suits ?? []).map((ItemType) => ({ ItemType })),
    Recipes: stacks(held.recipes),
    Consumables: stacks(held.consumables),
    Affiliations: Object.entries(held.standing ?? {}).map(([Tag, Standing]) => ({ Tag, Standing })),
  } as unknown as RawInventoryData;
}

function mastered(...names: string[]): MasteryData {
  return { items: names.map((name) => ({ name, status: "mastered" })), stats: {} } as never;
}

function target(name: string, held: RawInventoryData, mastery: MasteryData | null = null) {
  const match = resolveAcquisition({ itemDb, inventory: held, mastery, only: [name] })[0];
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

function plan(found: AcquisitionTarget, held: RawInventoryData): ResolvedPlan {
  const resolved = resolvePlanFor(found, { itemDb, inventory: held, now: NOW });
  if (!resolved) throw new Error(`no plan for ${found.name}`);
  return resolved;
}

const rows = (resolved: ResolvedPlan) => resolved.groups.flatMap((group) => group.rows);

function lines(resolved: ResolvedPlan) {
  const model = planSteps(resolved, { t: (key, vars) => `${key}${JSON.stringify(vars ?? {})}` });
  const open = model.sections
    .flatMap((section) => section.entries)
    .flatMap((entry) => (entry.kind === "trip" ? entry.lines : [entry]));
  return { open, done: model.done };
}

describe("standing reads through one reader", () => {
  const state = () =>
    readPlayerState(
      inventory({
        standing: {
          LibrarySyndicate: 82_540,
          VoxSyndicate: 263_000,
          RedVeilSyndicate: 247_000,
          SteelMeridianSyndicate: 254_197,
          ArbitersSyndicate: -71_000,
        },
      }),
      {},
    );

  it("finds every syndicate the rank table names, and Simaris, which has no ranks", () => {
    expect(balanceFor(state(), "Cephalon Simaris Standing", "x")).toBe(82_540);
    expect(balanceFor(state(), "Simaris Standing", "x")).toBe(82_540);
    expect(balanceFor(state(), "Vox Solaris Standing", "x")).toBe(263_000);
    expect(balanceFor(state(), "Red Veil Standing", "x")).toBe(247_000);
    expect(balanceFor(state(), "Arbiters of Hexis Standing", "x")).toBe(-71_000);
  });

  it("pays any-syndicate standing from the best faction syndicate", () => {
    expect(balanceFor(state(), "Syndicate Standing", "x")).toBe(254_197);
  });

  it("reads a syndicate never joined as none, and no affiliations as unknown", () => {
    expect(balanceFor(state(), "New Loka Standing", "x")).toBe(0);
    expect(balanceFor(readPlayerState({} as RawInventoryData, {}), "Red Veil Standing", "x")).toBe(
      null,
    );
  });

  it("covers Gara's Simaris standing", () => {
    const held = inventory({ standing: { LibrarySyndicate: 82_540 } });
    const { open } = lines(plan(target("Gara", held), held));
    expect(open.some((line) => line.title.includes("Cephalon Simaris Standing"))).toBe(false);
  });
});

describe("owned gear counts as owned", () => {
  it("reads gear off the Consumables slice", () => {
    const owned = aggregateComponentOwnership(inventory({ consumables: { [NOSAM_CUTTER]: 1 } }));
    expect(owned.get(NOSAM_CUTTER)).toBe(1);
  });

  it("settles Gara's Nosam Cutter once held, for both copies", () => {
    const held = inventory({ consumables: { [NOSAM_CUTTER]: 1 } });
    const gara = target("Gara", held);
    expect(gara.parts.copies).toBe(2);
    const cutter = rows(plan(gara, held)).find((row) => row.label === "Nosam Cutter");
    expect(cutter?.qty).toMatchObject({ required: 1, owned: 1 });
    expect(cutter?.done).toBe(true);
  });
});

describe("a reusable purchase is made once", () => {
  it("costs the same for two copies as for one", () => {
    const spent = (mastery: MasteryData | null) => {
      const held = inventory();
      const found = target("Gara", held, mastery);
      const ledger = plan(found, held).ledger.find((entry) => entry.currency === "Ostron Standing");
      return { copies: found.parts.copies, spent: ledger?.spent };
    };
    const one = spent(mastered("Gara"));
    const two = spent(null);
    expect([one.copies, two.copies]).toEqual([1, 2]);
    expect(two.spent).toBe(one.spent);
  });
});

describe("a frame with one copy built and one more to build", () => {
  const held = () =>
    inventory({
      suits: [ORAXIA],
      recipes: { [`${WR}/OraxiaHelmetBlueprint`]: 1, [`${WR}/OraxiaSystemsBlueprint`]: 1 },
    });

  it("keeps its final build open", () => {
    const oraxia = target("Oraxia", held());
    expect(oraxia.parts.copies).toBe(1);
    const build = rows(plan(oraxia, held())).find((row) => row.label === "Oraxia");
    expect(build?.done).toBe(false);
  });

  it("counts blueprints held on the card and on the farm chips", () => {
    const oraxia = target("Oraxia", held());
    expect(partsRead(oraxia)).toMatchObject({ have: 2, need: 4 });
    const drop = lines(plan(oraxia, held())).open.find((line) => line.kind === "drop");
    const done = drop?.parts.filter((part) => part.done).map((part) => part.label);
    expect(done).toEqual(["Neuroptics", "Systems"]);
  });

  it("leaves the main blueprint unowned in the shop picker", () => {
    const shop = plan(target("Oraxia", held()), held()).shop;
    const units = shop?.groups.find((group) => group.item === "Oraxia")?.units ?? [];
    const owned = Object.fromEntries(units.map((unit) => [unit.ware, unit.owned]));
    expect(owned).toMatchObject({
      "Oraxia Blueprint": false,
      "Oraxia Neuroptics Blueprint": true,
      "Oraxia Chassis Blueprint": false,
      "Oraxia Systems Blueprint": true,
    });
  });

  it("times the build still owed", () => {
    const ownership = aggregateComponentOwnership(held());
    const totals = buildTotals([ORAXIA], ORAXIA, 1, itemDb, ownership);
    expect(totals?.minTime).toBeGreaterThan(0);
    expect(totals?.maxTime).toBeGreaterThanOrEqual(totals?.minTime ?? 0);
  });

  it("sizes the totals to every copy", () => {
    const one = buildTotals([GARA], GARA, 1, itemDb, new Map());
    const two = buildTotals([GARA], GARA, 2, itemDb, new Map());
    expect(two?.credits).toBeGreaterThan(one?.credits ?? 0);
  });
});

describe("modular build totals", () => {
  it("sums every K-Drive part the plan builds", () => {
    const held = inventory();
    const badBaby = target("Bad Baby", held);
    const resolved = plan(badBaby, held);
    const totals = buildTotals(resolved.builds, badBaby.uniqueName, 1, itemDb, new Map());
    expect(totals?.credits).toBe(20_000);
  });
});

describe("a shared shop", () => {
  const units = (resolved: ResolvedPlan, item: string) =>
    resolved.shop?.groups.find((group) => group.item === item)?.units.map((unit) => unit.id) ?? [];

  it("sizes each item by its own copies, whichever plan opens it", () => {
    const held = inventory();
    const fromRuvox = units(plan(target("Ruvox", held), held), "Dante");
    const fromDante = units(plan(target("Dante", held), held), "Dante");
    expect(fromRuvox).toHaveLength(8);
    expect(fromRuvox).toEqual(fromDante);
  });

  it("counts a ware another item lists as the plan's own when its recipe consumes it", () => {
    const held = inventory();
    const shop = plan(target("Pride", held), held).shop;
    const crimson = shop?.own.totals.find((line) => line.currency === "Crimson Talent");
    expect(crimson?.need).toBeGreaterThanOrEqual(45);
  });
});

describe("item names read the same with or without diacritics", () => {
  it("reads Hollvanian Pitchweave Fragment off the Höllvanian item", () => {
    const state = readPlayerState(
      {
        MiscItems: [
          {
            ItemType: "/Lotus/Types/Gameplay/1999Wf/Resources/1999ResourceCommonB",
            ItemCount: 800,
          },
        ],
      } as unknown as RawInventoryData,
      itemDb,
    );
    expect(balanceFor(state, "Hollvanian Pitchweave Fragment", "Temple")).toBe(800);
  });
});

describe("plan data reads against the wiki", () => {
  it("settles Operational Supply rank-ups from the Plague Star syndicate's rank", () => {
    const held = {
      ...inventory(),
      Affiliations: [{ Tag: "EventSyndicate", Standing: 8_475, Title: 3 }],
    } as unknown as RawInventoryData;
    const champion = rows(plan(target("Zaw", held), held)).find(
      (row) => row.label === "Champion rank-up",
    );
    expect(champion?.done).toBe(true);
  });

  it.each(["Hec Hound", "Bhaira Hound", "Dorma Hound"])("walks %s as a Sister sequence", (name) => {
    const held = inventory();
    const resolved = plan(target(name, held), held);
    expect(resolved.sequence).toBe(true);
    expect(lines(resolved).open.find((line) => line.kind === "drop")?.title).toMatch(
      /^Spawn a Sister whose Hound has the \w+ Model$/,
    );
  });
});
