import { describe, expect, it } from "vitest";

import {
  ACQUISITION_SORTS,
  compareAcquisition,
  platFor,
  sortValue,
  type AcquisitionSort,
  type SortRow,
} from "../../../../../src/lib/suggest/acquisition/sort.js";
import type {
  AcquisitionPath,
  AcquisitionTarget,
} from "../../../../../src/lib/suggest/acquisition/types.js";

interface Shape {
  name: string;
  tier?: string | null;
  difficulty?: string | null;
  plat?: number | null;
  effort?: number;
}

function path(plat: number | null): AcquisitionPath {
  return {
    id: "market",
    kind: "market",
    covers: [],
    complete: true,
    steps: [],
    cost: { credits: null, plat: { set: plat, parts: [], partsTotal: null }, relics: null },
    effort: 0.5,
  };
}

function row(shape: Shape): SortRow {
  const target = {
    uniqueName: `/${shape.name}`,
    name: shape.name,
    imageUrl: null,
    kind: "warframe",
    weaponClass: null,
    isPrime: false,
    nemesis: null,
    incarnon: null,
    needs: ["mastery"],
    parts: {
      known: false,
      main: null,
      components: [],
      missing: [],
      materials: [],
      credits: 0,
      buildable: false,
    },
    paths: shape.plat === undefined ? [] : [path(shape.plat)],
    difficulty: shape.difficulty ?? null,
    tier: shape.tier ?? null,
    wiki: null,
    effort: shape.effort ?? 0.5,
  } as AcquisitionTarget;
  return { target, effort: shape.effort ?? 0.5 };
}

function order(
  rows: SortRow[],
  sort: AcquisitionSort,
  direction: "asc" | "desc" = "asc",
): string[] {
  return [...rows].sort(compareAcquisition(sort, direction)).map((entry) => entry.target.name);
}

const RATED = [
  row({ name: "EasyA", tier: "A", difficulty: "easy", plat: 200 }),
  row({ name: "HardS", tier: "S", difficulty: "brutal", plat: 20 }),
  row({ name: "Unknown" }),
];

describe("compareAcquisition", () => {
  it("recommends the easy A-tier over the brutal S-tier", () => {
    expect(order(RATED, "recommended")[0]).toBe("EasyA");
  });

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

describe("sortValue", () => {
  it("reads an unrated item as unknown rather than as the worst", () => {
    const unknown = row({ name: "Unknown" }).target;
    expect(sortValue(unknown, "difficulty")).toBeNull();
    expect(sortValue(unknown, "tier")).toBeNull();
    expect(sortValue(unknown, "plat")).toBeNull();
    expect(sortValue(unknown, "recommended")).toBeNull();
  });

  it("still scores an item rated on only one of the two halves", () => {
    const halfRated = row({ name: "Tiered", tier: "A" }).target;
    const rated = row({ name: "Rated", tier: "A", difficulty: "normal" }).target;
    expect(sortValue(halfRated, "recommended")).toBe(sortValue(rated, "recommended"));
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
