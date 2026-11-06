import { describe, expect, it } from "vitest";

import curatedWeapons from "../../../../../src/data/suggest/weapons.json";
import {
  createCurated,
  curated,
  mergeCurated,
} from "../../../../../src/lib/suggest/acquisition/curated.js";
import { buildPaths } from "../../../../../src/lib/suggest/acquisition/paths.js";
import { authoredPlan } from "../../../../../src/lib/suggest/acquisition/plan/data.js";
import { createRatings } from "../../../../../src/lib/suggest/acquisition/ratings.js";
import { farmScore, remainingEffort } from "../../../../../src/lib/suggest/acquisition/sort.js";
import { standingTedium } from "../../../../../src/lib/suggest/acquisition/standing.js";
import type {
  AcquisitionPath,
  AcquisitionTarget,
  PartPlan,
  PartState,
} from "../../../../../src/lib/suggest/acquisition/types.js";
import type { RawInventoryData } from "../../../../../src/types/inventory.js";

type Inputs = Parameters<typeof buildPaths>[0];

const TABLE = mergeCurated(createCurated(curatedWeapons), curated);

const VENTKIDS = standingTedium("Ventkids Standing");
const SIMARIS = standingTedium("Cephalon Simaris Standing");
const BASELINE = standingTedium("Red Veil Standing");

function part(name: string, missing: boolean, role: PartState["role"] = "component"): PartState {
  const owned = missing ? 0 : 1;
  return {
    uniqueName: `/${name}`,
    name,
    role,
    required: 1,
    owned,
    building: 0,
    held: 0,
    missing: 1 - owned,
  };
}

/** A recipe of a main blueprint and components; `missing` names the parts still to get. */
function recipe(item: string, components: string[], missing: string[], short = 0): PartPlan {
  const main = part(`${item} Blueprint`, missing.includes(`${item} Blueprint`), "main");
  const rest = components.map((name) => part(`${item} ${name}`, missing.includes(name)));
  const absent = [main, ...rest].filter((entry) => entry.missing > 0);
  return {
    known: true,
    main,
    components: rest,
    missing: absent,
    sourcing: absent,
    materials: [
      {
        uniqueName: "/ArgonCrystal",
        name: "Argon Crystal",
        required: 2,
        owned: 2 - short,
        missing: short,
      },
    ],
    credits: 0,
    copies: 1,
    foundry: false,
    buildable: false,
    foundryOnly: absent.length === 0 && short === 0,
  };
}

/** Gear the item database has no recipe for, handed over whole. */
const WHOLE: PartPlan = {
  known: false,
  main: null,
  components: [],
  missing: [],
  sourcing: [],
  materials: [],
  credits: 0,
  copies: 1,
  foundry: false,
  buildable: false,
  foundryOnly: false,
};

function paths(name: string, parts: PartPlan, overrides: Partial<Inputs> = {}): AcquisitionPath[] {
  return buildPaths({
    name,
    isPrime: false,
    parts,
    inventory: null,
    relicDb: null,
    plat: null,
    ratings: createRatings(undefined, TABLE),
    wanted: true,
    curated: TABLE,
    plan: authoredPlan(name),
    ...overrides,
  });
}

function standings(rows: Record<string, { standing: number; title?: number }>): RawInventoryData {
  return {
    Affiliations: Object.entries(rows).map(([Tag, row]) => ({
      Tag,
      Standing: row.standing,
      Title: row.title ?? 5,
    })),
  } as unknown as RawInventoryData;
}

function target(name: string, parts: PartPlan, found: AcquisitionPath[]): AcquisitionTarget {
  return {
    uniqueName: `/${name}`,
    name,
    imageUrl: null,
    kind: "weapon",
    weaponClass: "primary",
    modular: null,
    isPrime: false,
    nemesis: null,
    incarnon: null,
    needs: ["mastery"],
    mastered: false,
    parts,
    paths: found,
    difficulty: null,
    tier: null,
    wiki: null,
    effort: found[0]?.effort ?? 1,
  };
}

const FLUCTUS_PARTS = ["Barrel", "Stock", "Limbs"];
const VELOCITUS_PARTS = ["Barrel", "Receiver", "Stock"];
const RED_VEIL_RICH = standings({ RedVeilSyndicate: { standing: 50_000 } });
const RED_VEIL_POOR = standings({ RedVeilSyndicate: { standing: 1_000 } });

function fluctus(inventory: RawInventoryData | null): AcquisitionTarget {
  const parts = recipe("Fluctus", FLUCTUS_PARTS, ["Limbs"]);
  return target("Fluctus", parts, paths("Fluctus", parts, { inventory }));
}

describe("standing tedium", () => {
  it("rates Ventkids hardest, then Simaris, then every other standing", () => {
    expect(VENTKIDS).toBeGreaterThan(SIMARIS);
    expect(SIMARIS).toBeGreaterThan(BASELINE);
  });

  it.each([
    "Steel Meridian Standing",
    "The Hex Standing",
    "Solaris United Standing",
    "Entrati Standing",
    "Necraloid Standing",
    "Holdfasts Standing",
    "Cavia Standing",
    "Ostron Standing",
    "Syndicate Standing",
  ])("reads %s as the easy baseline", (currency) => {
    expect(standingTedium(currency)).toBe(BASELINE);
  });
});

describe("a route bought with standing", () => {
  it("rates the table's generic syndicate row by the standing that pays for it", () => {
    const found = paths("Fluctus", recipe("Fluctus", FLUCTUS_PARTS, ["Limbs"]));
    expect(found[0].kind).toBe("vendor");
    expect(found[0].effort).toBe(BASELINE);
  });

  it("ignores how much standing the route costs, rank-up grinds included", () => {
    const efforts = ["Bad Baby", "Flatbelly", "Needlenose", "Runway"].map(
      (name) => paths(name, WHOLE)[0]?.effort,
    );
    expect(new Set(efforts)).toEqual(new Set([VENTKIDS]));
  });

  it("rates a Ventkids route harder than a Simaris one, and that harder than a syndicate one", () => {
    const ventkids = paths("Needlenose", WHOLE)[0].effort;
    const simaris = paths("Heliocor", recipe("Heliocor", [], ["Heliocor Blueprint"]))[0].effort;
    const syndicate = paths("Telos Boltor", WHOLE)[0].effort;
    expect([ventkids, simaris, syndicate]).toEqual([VENTKIDS, SIMARIS, BASELINE]);
  });

  it("never lets a plan route read easier than the standing it still needs", () => {
    // The board drops from a race; its reactor, nose and jet are Ventkids buys.
    const found = paths("Feverspine", WHOLE);
    expect(found[0].kind).toBe("mission");
    expect(found[0].effort).toBe(VENTKIDS);
  });

  it("adds the partial penalty when standing buys only part of what is missing", () => {
    const parts = recipe("Fluctus", FLUCTUS_PARTS, ["Fluctus Blueprint", "Limbs"]);
    const vendor = paths("Fluctus", parts).find((path) => path.kind === "vendor");
    expect(vendor?.complete).toBe(false);
    expect(vendor?.effort).toBeGreaterThan(BASELINE);
  });

  it("leaves routes the plan does not buy with standing as they were", () => {
    const parts = recipe("Fluctus", FLUCTUS_PARTS, ["Fluctus Blueprint", "Limbs"]);
    const plat = () => 10;
    const rated = paths("Fluctus", parts, { plat });
    const unplanned = paths("Fluctus", parts, { plat, plan: null });
    for (const kind of ["lab", "trade"]) {
      const before = unplanned.find((path) => path.kind === kind)?.effort;
      expect(rated.find((path) => path.kind === kind)?.effort).toBe(before);
    }
  });

  it("leaves an item whose plan buys nothing with standing unchanged", () => {
    const parts = recipe("Hydroid", ["Neuroptics", "Chassis", "Systems"], ["Neuroptics"]);
    const planned = paths("Hydroid", parts);
    const unplanned = paths("Hydroid", parts, { plan: null });
    expect(planned.map((path) => path.effort)).toEqual(unplanned.map((path) => path.effort));
  });

  it("reads a standing item with only materials left as foundry work, not standing", () => {
    const parts = recipe("Fluctus", FLUCTUS_PARTS, [], 2);
    const found = paths("Fluctus", parts);
    expect(found).toEqual([]);
    expect(remainingEffort(target("Fluctus", parts, found))).toBe(0.05);
  });

  it("keeps scoring a standing route on the same terms as any other farm", () => {
    const easy = fluctus(null);
    const farmed = target("Fluctus", easy.parts, [{ ...easy.paths[0], effort: 0.55 }]);
    expect(farmScore(easy)).toBeLessThan(farmScore(farmed) ?? 0);
  });
});

describe("standing already banked", () => {
  it("ranks a banked item just above an otherwise-equal one", () => {
    const banked = farmScore(fluctus(RED_VEIL_RICH)) ?? 0;
    const short = farmScore(fluctus(RED_VEIL_POOR)) ?? 0;
    expect(banked).toBeLessThan(short);
    const nudge = fluctus(RED_VEIL_POOR).paths[0].effort - fluctus(RED_VEIL_RICH).paths[0].effort;
    expect(nudge).toBeGreaterThan(0);
    expect(nudge).toBeLessThan((SIMARIS - BASELINE) / 2);
  });

  it("never lifts a route past a less tedious standing", () => {
    const simaris = standings({ LibrarySyndicate: { standing: 1_000_000 } });
    const heliocor = recipe("Heliocor", [], ["Heliocor Blueprint"]);
    const bankedSimaris = paths("Heliocor", heliocor, { inventory: simaris })[0].effort;
    expect(bankedSimaris).toBeLessThan(SIMARIS);
    expect(bankedSimaris).toBeGreaterThan(BASELINE);
  });

  it("gives no nudge without an inventory", () => {
    expect(fluctus(null).paths[0].effort).toBe(fluctus(RED_VEIL_POOR).paths[0].effort);
  });

  it("gives no nudge when the payload carries no standing", () => {
    const blank = {} as RawInventoryData;
    expect(fluctus(blank).paths[0].effort).toBe(fluctus(RED_VEIL_POOR).paths[0].effort);
  });

  it("gives no nudge while a rank the purchase needs is not held", () => {
    const parts = recipe("Velocitus", VELOCITUS_PARTS, ["Receiver"]);
    const unranked = standings({ SteelMeridianSyndicate: { standing: 100_000, title: 0 } });
    const ranked = standings({ SteelMeridianSyndicate: { standing: 100_000, title: 2 } });
    const low = paths("Velocitus", parts, { inventory: unranked })[0].effort;
    expect(low).toBe(BASELINE);
    expect(paths("Velocitus", parts, { inventory: ranked })[0].effort).toBeLessThan(low);
  });

  it("needs every standing the route still owes", () => {
    const parts = recipe("Velocitus", VELOCITUS_PARTS, ["Receiver", "Barrel"]);
    const steelOnly = standings({
      SteelMeridianSyndicate: { standing: 100_000 },
      CephalonSudaSyndicate: { standing: 0 },
    });
    const both = standings({
      SteelMeridianSyndicate: { standing: 100_000 },
      CephalonSudaSyndicate: { standing: 100_000 },
    });
    expect(paths("Velocitus", parts, { inventory: steelOnly })[0].effort).toBe(BASELINE);
    expect(paths("Velocitus", parts, { inventory: both })[0].effort).toBeLessThan(BASELINE);
  });

  it("counts only what is still missing", () => {
    const parts = recipe("Velocitus", VELOCITUS_PARTS, ["Receiver"]);
    const steelOnly = standings({
      SteelMeridianSyndicate: { standing: 100_000 },
      CephalonSudaSyndicate: { standing: 0 },
    });
    expect(paths("Velocitus", parts, { inventory: steelOnly })[0].effort).toBeLessThan(BASELINE);
  });
});
