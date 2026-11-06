import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import {
  ACQUISITION_SORTS,
  compareAcquisition,
  farmScore,
  partsLeft,
  platFor,
  sortKeys,
  sortRow,
  type AcquisitionSort,
  type SortRow,
} from "../../../../../src/lib/suggest/acquisition/sort.js";
import { inventory, itemDb, LITH_M1, MAGP_BP, relicDb } from "./fixtures.js";
import type {
  AcquisitionKind,
  AcquisitionPath,
  AcquisitionTarget,
  ModularPlan,
  NeedReason,
  PartPlan,
  PartState,
  PathKind,
} from "../../../../../src/lib/suggest/acquisition/types.js";

interface Shape {
  name: string;
  tier?: string | null;
  difficulty?: string | null;
  plat?: number | null;
  effort?: number;
  /** False leaves the item with no recipe the app can walk. */
  recipe?: boolean;
  /** Blueprints still to find. */
  missing?: number;
  /** Parts the recipe has in all, the missing ones included; defaults to them. */
  total?: number;
  needs?: NeedReason[];
  kind?: AcquisitionKind;
  buildable?: boolean;
  /** Materials the remaining builds are still short of. */
  short?: number;
  /** The material that is short; a staple by default. */
  material?: string;
  heads?: { total: number; owned: number };
}

function path(plat: number | null, effort = 0.5, kind: PathKind = "market"): AcquisitionPath {
  return {
    id: kind,
    kind,
    covers: [],
    complete: true,
    steps: [],
    cost: {
      credits: null,
      plat: { set: plat, setSlug: null, parts: [], partsTotal: null },
      relics: null,
    },
    effort,
  };
}

function parts(shape: Shape): PartPlan {
  const absent = shape.missing ?? 0;
  const components = Array.from(
    { length: Math.max(absent, shape.total ?? absent) },
    (_, index): PartState => ({
      uniqueName: `/${shape.name}/part${index}`,
      name: `Part ${index}`,
      role: "component",
      required: 1,
      owned: index < absent ? 0 : 1,
      building: 0,
      held: 0,
      missing: index < absent ? 1 : 0,
    }),
  );
  const missing = components.slice(0, absent);
  const short = shape.short ?? 0;
  return {
    known: shape.recipe ?? false,
    main: null,
    components,
    missing,
    sourcing: missing,
    materials: [
      {
        uniqueName: `/${shape.material ?? "Plastids"}`,
        name: shape.material ?? "Plastids",
        required: 100,
        owned: 100 - short,
        missing: short,
      },
    ],
    credits: 0,
    copies: 1,
    foundry: false,
    buildable: shape.buildable ?? false,
    foundryOnly: absent === 0 && short === 0,
  };
}

function modular(heads: { total: number; owned: number }): ModularPlan {
  return {
    gear: "moa",
    headLabelKey: "nextUp.acqParts",
    heads: Array.from({ length: heads.total }, (_, index) => ({
      uniqueName: `/head${index}`,
      name: `Head ${index}`,
      imageUrl: null,
      owned: index < heads.owned,
    })),
    owned: heads.owned,
    requiresGilding: true,
    slots: [],
  };
}

function targetFor(shape: Shape): AcquisitionTarget {
  const target = {
    uniqueName: `/${shape.name}`,
    name: shape.name,
    imageUrl: null,
    kind: shape.kind ?? "warframe",
    weaponClass: shape.kind === "weapon" ? "primary" : null,
    modular: shape.heads ? modular(shape.heads) : null,
    isPrime: false,
    nemesis: null,
    incarnon: null,
    needs: shape.needs ?? ["mastery"],
    parts: parts(shape),
    paths: shape.plat === undefined ? [] : [path(shape.plat, shape.effort ?? 0.5)],
    difficulty: shape.difficulty ?? null,
    tier: shape.tier ?? null,
    wiki: null,
    effort: shape.effort ?? 0.5,
  } as AcquisitionTarget;
  return target;
}

function row(shape: Shape): { target: AcquisitionTarget; effort: number } {
  return { target: targetFor(shape), effort: shape.effort ?? 0.5 };
}

function order(
  rows: ReadonlyArray<{ target: AcquisitionTarget; effort: number }>,
  sort: AcquisitionSort,
  direction: "asc" | "desc" = "asc",
): string[] {
  const keyed: SortRow[] = rows.map((entry) => sortRow(entry.target, entry.effort, sort));
  return keyed.sort(compareAcquisition(direction)).map((entry) => entry.target.name);
}

const RATED = [
  row({ name: "EasyA", tier: "A", difficulty: "easy", plat: 200 }),
  row({ name: "HardS", tier: "S", difficulty: "brutal", plat: 20 }),
  row({ name: "Unknown" }),
];

describe("compareAcquisition", () => {
  it("puts the easiest farm first on difficulty", () => {
    expect(order(RATED, "difficulty")).toEqual(["EasyA", "HardS", "Unknown"]);
  });

  it("puts the best tier first on tier", () => {
    expect(order(RATED, "tier")).toEqual(["HardS", "EasyA", "Unknown"]);
  });

  it("puts the cheapest plat first on plat", () => {
    expect(order(RATED, "plat")).toEqual(["HardS", "EasyA", "Unknown"]);
  });

  it.each(ACQUISITION_SORTS)("keeps an unrated item off the front under %s", (sort) => {
    expect(order(RATED, sort)[0]).not.toBe("Unknown");
    expect(order(RATED, sort, "desc")[0]).not.toBe("Unknown");
    expect(order(RATED, sort, "desc")[2]).toBe("Unknown");
  });

  it("reverses the rated items on a flipped direction", () => {
    expect(order(RATED, "difficulty", "desc")).toEqual(["HardS", "EasyA", "Unknown"]);
    expect(order(RATED, "tier", "desc")).toEqual(["EasyA", "HardS", "Unknown"]);
  });

  it("breaks a tie on effort, then on name", () => {
    const rows = [
      row({ name: "Slow", tier: "A", difficulty: "easy", effort: 0.9 }),
      row({ name: "Quick", tier: "A", difficulty: "easy", effort: 0.1 }),
      row({ name: "Also", tier: "A", difficulty: "easy", effort: 0.1 }),
    ];
    expect(order(rows, "recommended")).toEqual(["Also", "Quick", "Slow"]);
  });
});

describe("recommended", () => {
  it("leads with what the foundry would take right now", () => {
    const rows = [
      row({ name: "OneShort", tier: "S", recipe: true, missing: 1 }),
      row({ name: "Materials", tier: "D", recipe: true }),
      row({ name: "Ready", tier: "D", recipe: true, buildable: true }),
    ];
    expect(order(rows, "recommended")).toEqual(["Ready", "Materials", "OneShort"]);
  });

  it("sorts two blueprints short behind one blueprint short", () => {
    const rows = [
      row({ name: "ThreeShort", tier: "B", recipe: true, missing: 3, total: 4, plat: 10 }),
      row({ name: "OneShort", tier: "B", recipe: true, missing: 1, total: 4, plat: 10 }),
      row({ name: "TwoShort", tier: "B", recipe: true, missing: 2, total: 4, plat: 10 }),
    ];
    expect(order(rows, "recommended")).toEqual(["OneShort", "TwoShort", "ThreeShort"]);
  });

  it("counts a gear type's unbanked head parts as its distance from ready", () => {
    const rows = [
      row({ name: "ThreeLeft", heads: { total: 4, owned: 1 } }),
      row({ name: "OneLeft", heads: { total: 4, owned: 3 } }),
    ];
    expect(order(rows, "recommended")).toEqual(["OneLeft", "ThreeLeft"]);
    expect(partsLeft(rows[1]!.target)).toBe(1);
    expect(partsLeft(rows[0]!.target)).toBe(3);
  });

  it("puts an item with no recipe behind every one that has one", () => {
    const rows = [
      row({ name: "NoRecipe", tier: "S" }),
      row({ name: "FiveShort", tier: "D", recipe: true, missing: 5 }),
    ];
    expect(order(rows, "recommended")).toEqual(["FiveShort", "NoRecipe"]);
  });

  it("puts cheap work several parts out ahead of one part behind a hard farm", () => {
    const rows = [
      row({ name: "OneHard", tier: "S", recipe: true, missing: 1, plat: 10, effort: 0.7 }),
      row({ name: "ThreeCheap", tier: "D", recipe: true, missing: 3, plat: 90, effort: 0.1 }),
      row({ name: "Ready", tier: "D", recipe: true, buildable: true }),
    ];
    expect(order(rows, "recommended")).toEqual(["Ready", "ThreeCheap", "OneHard"]);
  });

  it("ranks the work left above the tier", () => {
    const rows = [
      row({ name: "GrimS", tier: "S", recipe: true, missing: 1, plat: 10, effort: 0.8 }),
      row({ name: "EasyD", tier: "D", recipe: true, missing: 1, plat: 10, effort: 0.2 }),
    ];
    expect(order(rows, "recommended")).toEqual(["EasyD", "GrimS"]);
  });

  it("weighs parts in hand and tier against each other at the same route", () => {
    const rows = [
      row({ name: "TwoS", tier: "S", recipe: true, missing: 2, plat: 10, effort: 0.4 }),
      row({ name: "OneD", tier: "D", recipe: true, missing: 1, plat: 10, effort: 0.4 }),
      row({ name: "OneA", tier: "A", recipe: true, missing: 1, plat: 10, effort: 0.4 }),
    ];
    expect(order(rows, "recommended")).toEqual(["OneA", "OneD", "TwoS"]);
  });

  it("sorts an item no route finishes behind one a route does", () => {
    const rows = [
      row({ name: "NoRoute", tier: "S", recipe: true, missing: 1 }),
      row({ name: "Grim", tier: "D", recipe: true, missing: 4, plat: 10, effort: 1 }),
    ];
    expect(order(rows, "recommended")).toEqual(["Grim", "NoRoute"]);
    expect(order(rows, "recommended", "desc")).toEqual(["Grim", "NoRoute"]);
  });

  it("still leads with a ready build nothing has rated", () => {
    const rows = [
      row({ name: "RatedShort", tier: "S", recipe: true, missing: 1, plat: 10, effort: 0 }),
      row({ name: "UnratedReady", recipe: true, buildable: true }),
    ];
    expect(order(rows, "recommended")).toEqual(["UnratedReady", "RatedShort"]);
  });

  it("puts a target with only sub-builds left ahead of a cheap farm", () => {
    const rows = [
      row({ name: "CheapFarm", tier: "S", recipe: true, missing: 1, plat: 10, effort: 0.1 }),
      row({ name: "BuildsLeft", tier: "D", recipe: true }),
    ];
    expect(order(rows, "recommended")).toEqual(["BuildsLeft", "CheapFarm"]);
    expect(sortKeys(rows[1]!.target, "recommended")[0]).toBe(1);
  });

  it("keeps a target short on a real farm behind a cheap farm", () => {
    const rows = [
      row({ name: "ShortMaterials", tier: "S", recipe: true, short: 3_000, material: "Cryotic" }),
      row({ name: "CheapFarm", tier: "D", recipe: true, missing: 1, plat: 10, effort: 0.1 }),
    ];
    expect(order(rows, "recommended")).toEqual(["CheapFarm", "ShortMaterials"]);
    expect(sortKeys(rows[0]!.target, "recommended")[0]).toBe(2);
  });

  it("puts a target short only on staples ahead of a cheap farm", () => {
    const rows = [
      row({ name: "CheapFarm", tier: "D", recipe: true, missing: 1, plat: 10, effort: 0.1 }),
      row({ name: "ShortStaples", tier: "S", recipe: true, short: 40_000 }),
    ];
    expect(order(rows, "recommended")).toEqual(["ShortStaples", "CheapFarm"]);
    expect(sortKeys(rows[1]!.target, "recommended")[0]).toBe(2);
  });
});

describe("still farming at the same difficulty", () => {
  const farm = { recipe: true, total: 4, plat: 10, effort: 0.4 } as const;

  it("puts the top subsume three parts in ahead of a mid subsume one part in", () => {
    const rows = [
      row({ ...farm, name: "Khora", needs: ["mastery", "subsume"], missing: 3 }),
      row({ ...farm, name: "Grendel", needs: ["subsume"], missing: 1 }),
    ];
    expect(order(rows, "recommended")).toEqual(["Grendel", "Khora"]);
  });

  it("puts a near-worthless subsume three parts in behind that mastery frame", () => {
    const rows = [
      row({ ...farm, name: "Caliban", needs: ["subsume"], missing: 1 }),
      row({ ...farm, name: "Khora", needs: ["mastery", "subsume"], missing: 3 }),
    ];
    expect(order(rows, "recommended")).toEqual(["Khora", "Caliban"]);
  });

  it("puts a frame ahead of a rank-30 weapon at the same parts and tier", () => {
    const rows = [
      row({ ...farm, name: "Rifle", tier: "B", kind: "weapon", missing: 1 }),
      row({ ...farm, name: "Frame", tier: "B", missing: 1 }),
    ];
    expect(order(rows, "recommended")).toEqual(["Frame", "Rifle"]);
  });
});

describe("plat only", () => {
  /** Mag Prime with its blueprint in hand, short only the Neuroptics a vaulted relic pays. */
  function vaultedMagPrime(misc: Record<string, number> = {}): AcquisitionTarget {
    const db = relicDb();
    db.groups["Lith M1"]!.dropping = "none";
    const [target] = resolveAcquisition({
      itemDb: itemDb(),
      inventory: inventory({ recipes: { [MAGP_BP]: 1 }, misc }),
      relicDb: db,
      plat: (name) => (name === "Mag Prime Set" ? 60 : null),
      only: ["Mag Prime"],
    });
    return target!;
  }

  function plat(name: string, price: number | null): { target: AcquisitionTarget; effort: number } {
    const entry = row({ name, recipe: true, missing: 1, total: 4 });
    entry.target.paths = [path(price, 0.15, "trade")];
    return entry;
  }

  it("puts a vaulted Prime with no relic held behind a normal farm", () => {
    const prime = vaultedMagPrime();
    expect(prime.parts.sourcing.map((part) => part.name)).toEqual(["Mag Prime Neuroptics"]);
    const farm = row({ name: "Farm", recipe: true, missing: 1, total: 4, plat: 10, effort: 0.9 });
    expect(order([{ target: prime, effort: prime.effort }, farm], "recommended")).toEqual([
      "Farm",
      "Mag Prime",
    ]);
    expect(sortKeys(prime, "recommended")).toEqual([3, 60]);
  });

  it("keeps it farming on the relic route once a relic for the part is held", () => {
    const prime = vaultedMagPrime({ [LITH_M1]: 1 });
    const relics = prime.paths.find((entry) => entry.kind === "relics")!;
    const trade = prime.paths.find((entry) => entry.kind === "trade")!;
    expect(relics.effort).toBeGreaterThan(trade.effort);
    expect(sortKeys(prime, "recommended")[0]).toBe(2);
    expect(farmScore(prime)).toBeCloseTo(farmScore({ ...prime, paths: [relics] })!);
    const atTrade = farmScore({ ...prime, paths: [{ ...trade, kind: "mission" }] })!;
    expect(farmScore(prime)).not.toBeCloseTo(atTrade);
  });

  it("orders plat-only items by plat, cheaper first", () => {
    const rows = [plat("Dear", 90), plat("Cheap", 30)];
    expect(order(rows, "recommended")).toEqual(["Cheap", "Dear"]);
    expect(sortKeys(rows[1]!.target, "recommended")).toEqual([3, 30]);
  });

  it("leaves an unpriced trade still farming with no score", () => {
    expect(sortKeys(plat("Unpriced", null).target, "recommended")).toEqual([2, null]);
  });

  it("leaves the plat sort reading plat alone", () => {
    const rows = [
      plat("PlatOnly", 50),
      row({ name: "Farm", recipe: true, missing: 1, total: 4, plat: 20, effort: 0.6 }),
      plat("PlatCheap", 10),
    ];
    for (const entry of rows) {
      expect(sortKeys(entry.target, "plat")).toEqual([platFor(entry.target)]);
    }
    expect(order(rows, "plat")).toEqual(["PlatCheap", "Farm", "PlatOnly"]);
  });
});

describe("sortKeys", () => {
  it("reads an unrated item as unknown rather than as the worst", () => {
    const unknown = row({ name: "Unknown" }).target;
    expect(sortKeys(unknown, "difficulty")).toEqual([null]);
    expect(sortKeys(unknown, "tier")).toEqual([null]);
    expect(sortKeys(unknown, "plat")).toEqual([null]);
    expect(sortKeys(unknown, "recommended").slice(1)).toEqual([null]);
  });

  it("orders a build-only target by work left, then parts left, then tier", () => {
    const target = row({ name: "Keys", tier: "B", recipe: true }).target;
    expect(sortKeys(target, "recommended")).toEqual([1, 0.05, 0, 3]);
  });

  it("orders a farm by its negated score: worth times closeness over difficulty", () => {
    const target = row({
      name: "Keys",
      tier: "B",
      recipe: true,
      missing: 2,
      plat: 40,
      effort: 0.3,
    }).target;
    const [band, score] = sortKeys(target, "recommended");
    expect(band).toBe(2);
    expect(score).toBeCloseTo(-((1 * (1 / 3)) / 0.3));
  });
});

describe("sortRow", () => {
  it("carries the keys the comparator would otherwise work out per comparison", () => {
    for (const sort of ACQUISITION_SORTS) {
      const target = targetFor({ name: "Keys", tier: "B", recipe: true, missing: 2, plat: 40 });
      expect(sortRow(target, 0.5, sort).keys).toEqual(sortKeys(target, sort));
    }
  });

  it("prices a row nothing quotes as unknown rather than as free", () => {
    expect(sortRow(targetFor({ name: "Free" }), 0.5, "plat").price).toBe(Number.POSITIVE_INFINITY);
    expect(sortRow(targetFor({ name: "Cheap", plat: 40 }), 0.5, "plat").price).toBe(40);
  });
});

describe("platFor", () => {
  it("takes the cheapest plat any route asks", () => {
    const target = row({ name: "Cheap", plat: 90 }).target;
    target.paths = [path(90), path(40), path(null)];
    expect(platFor(target)).toBe(40);
  });

  it("reports unknown when nothing prices it", () => {
    expect(platFor(row({ name: "Free" }).target)).toBeNull();
    expect(platFor(row({ name: "Unpriced", plat: null }).target)).toBeNull();
  });
});

describe("plat and difficulty over resolved targets", () => {
  const PRICES: Record<string, number> = { "Mag Set": 120, "Mag Prime Set": 60, "Volt Set": 30 };

  function resolvedOrder(sort: AcquisitionSort, direction: "asc" | "desc"): string[] {
    const targets = resolveAcquisition({
      itemDb: itemDb(),
      inventory: null,
      plat: (name) => PRICES[name] ?? null,
      ratings: { "Mag Prime": { difficulty: "brutal" } },
    });
    return targets
      .map((target) => sortRow(target, target.effort, sort))
      .sort(compareAcquisition(direction))
      .map((entry) => entry.target.name);
  }

  it("puts the cheapest set first on plat ascending", () => {
    expect(resolvedOrder("plat", "asc")).toEqual(["Volt", "Mag Prime", "Mag"]);
    expect(resolvedOrder("plat", "desc")).toEqual(["Mag", "Mag Prime", "Volt"]);
  });

  it("puts the easiest farm first on difficulty ascending", () => {
    expect(resolvedOrder("difficulty", "asc")).toEqual(["Volt", "Mag", "Mag Prime"]);
    expect(resolvedOrder("difficulty", "desc")).toEqual(["Mag Prime", "Mag", "Volt"]);
  });
});
