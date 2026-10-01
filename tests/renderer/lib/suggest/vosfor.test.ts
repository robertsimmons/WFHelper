import { describe, expect, it } from "vitest";

import {
  VOSFOR_DATA,
  VOSFOR_PATH,
  dissolvePlan,
  packChance,
  packs,
  rankForArcanes,
  rankForPlatinum,
  vosforBalance,
  type VosforCollection,
} from "../../../../src/lib/suggest/vosfor.js";
import type { RawInventoryData } from "../../../../src/types/inventory.js";

const ALPHA: VosforCollection = {
  name: "Alpha",
  vosfor: 200,
  credits: 50000,
  arcanesPerPack: 3,
  pools: [
    { rarity: "Uncommon", chance: 0.5, arcanes: ["A1", "A2"] },
    { rarity: "Rare", chance: 0.5, arcanes: ["A3"] },
  ],
};

const BETA: VosforCollection = {
  name: "Beta",
  vosfor: 200,
  credits: 50000,
  arcanesPerPack: 3,
  pools: [{ rarity: "Rare", chance: 1, arcanes: ["B1", "B2", "B3", "B4"] }],
};

const COLLECTIONS = [ALPHA, BETA];
const max21 = (): number => 21;

function holdings(rows: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(rows).map(([name, count]) => [name.toLowerCase(), count]));
}

describe("vosfor balance and packs", () => {
  it("reads DistillPoints out of MiscItems", () => {
    const inventory = {
      MiscItems: [
        { ItemType: "/Lotus/Types/Items/MiscItems/Kuva", ItemCount: 900 },
        { ItemType: VOSFOR_PATH, ItemCount: 1234 },
      ],
    } as unknown as RawInventoryData;
    expect(vosforBalance(inventory)).toBe(1234);
    expect(vosforBalance({} as RawInventoryData)).toBe(0);
    expect(vosforBalance(null)).toBeNull();
  });

  it("floors the balance into 200-Vosfor packs", () => {
    expect(packs(1234)).toBe(6);
    expect(packs(199)).toBe(0);
    expect(packs(400)).toBe(2);
    expect(packs(null)).toBe(0);
  });

  it("ships collections and yields", () => {
    expect(VOSFOR_DATA.collections.length).toBeGreaterThan(0);
    expect(VOSFOR_DATA.collections.every((c) => c.pools.length > 0)).toBe(true);
    expect(Object.keys(VOSFOR_DATA.yields).length).toBeGreaterThan(0);
  });
});

const names = (rows: ReadonlyArray<{ name: string }>): string[] => rows.map((row) => row.name);

describe("pack ranking for your arcanes", () => {
  const popular = [
    { name: "A1", count: 10, wikiUrl: "" },
    { name: "A3", count: 1, wikiUrl: "" },
    { name: "B1", count: 3, wikiUrl: "" },
  ];
  const prices: Record<string, number> = { A2: 7 };
  const priceOf = (name: string): number | null => prices[name] ?? null;

  it("weights each needed popular arcane by its odds and popularity", () => {
    // Alpha: A1 3*0.25*10 = 7.5, A3 3*0.5*1 = 1.5. Beta: B1 3*0.25*3 = 2.25.
    const ranks = rankForArcanes(COLLECTIONS, popular, holdings({ A1: 4 }), max21, priceOf);
    expect(ranks?.map((rank) => rank.collection)).toEqual(["Alpha", "Beta"]);
    const [alpha, beta] = ranks ?? [];
    expect(alpha?.score).toBeCloseTo(9);
    expect(alpha?.top).toMatchObject({ name: "A1", held: 4, max: 21 });
    expect(alpha?.top?.contribution).toBeCloseTo(7.5);
    expect(names(alpha?.rows ?? [])).toEqual(["A1", "A3", "A2"]);
    expect(alpha?.rows[2]).toMatchObject({ held: 0, max: 21, platinum: 7, contribution: 0 });
    expect(alpha?.rows[0]?.chance).toBeCloseTo(packChance(0.25, 3));
    expect(packChance(0.25, 3)).toBeCloseTo(1 - 0.75 ** 3);
    expect(beta?.score).toBeCloseTo(2.25);
    expect(names(beta?.rows ?? [])).toEqual(["B1", "B2", "B3", "B4"]);
  });

  it("gives an arcane at max copies nothing and still lists its pack", () => {
    const full = holdings({ A1: 21, A3: 30 });
    const ranks = rankForArcanes(COLLECTIONS, popular, full, max21, priceOf);
    expect(ranks?.map((rank) => rank.collection)).toEqual(["Beta", "Alpha"]);
    expect(ranks?.[0]?.top?.name).toBe("B1");
    expect(ranks?.[1]).toMatchObject({ score: 0, top: null });
    expect(names(ranks?.[1]?.rows ?? [])).toEqual(["A1", "A2", "A3"]);
  });

  it("lists every pack by name when nothing is needed, and nothing without holdings", () => {
    expect(rankForArcanes(COLLECTIONS, popular, null, max21, priceOf)).toBeNull();
    const full = holdings({ A1: 21, A3: 21, B1: 21 });
    const ranks = rankForArcanes([BETA, ALPHA], popular, full, max21, priceOf);
    expect(ranks?.map((rank) => rank.collection)).toEqual(["Alpha", "Beta"]);
    expect(ranks?.every((rank) => rank.score === 0 && rank.top === null)).toBe(true);
  });
});

describe("pack ranking for platinum", () => {
  const prices: Record<string, number> = { A1: 10, A3: 2, B2: 40 };
  const priceOf = (name: string): number | null => prices[name] ?? null;

  it("averages platinum per pack, unpriced as zero and last", () => {
    // Alpha: 3*(0.25*10 + 0.5*2) = 10.5. Beta: 3*0.25*40 = 30.
    const ranks = rankForPlatinum(COLLECTIONS, null, max21, priceOf);
    expect(ranks.map((rank) => rank.collection)).toEqual(["Beta", "Alpha"]);
    const [beta, alpha] = ranks;
    expect(beta?.score).toBeCloseTo(30);
    expect(beta?.top).toMatchObject({ name: "B2", platinum: 40, held: null });
    expect(names(beta?.rows ?? [])).toEqual(["B2", "B1", "B3", "B4"]);
    expect(alpha?.score).toBeCloseTo(10.5);
    expect(names(alpha?.rows ?? [])).toEqual(["A1", "A3", "A2"]);
  });

  it("puts a zero-priced arcane ahead of an unpriced one", () => {
    const ranks = rankForPlatinum([BETA], null, max21, (name) => (name === "B4" ? 0 : null));
    expect(names(ranks[0]?.rows ?? [])).toEqual(["B4", "B1", "B2", "B3"]);
    expect(ranks[0]?.top).toBeNull();
  });

  it("carries held copies when holdings are read", () => {
    const ranks = rankForPlatinum(COLLECTIONS, holdings({ B2: 5 }), max21, priceOf);
    expect(ranks[0]?.top).toMatchObject({ name: "B2", held: 5, max: 21 });
    expect(ranks[0]?.rows[1]?.held).toBe(0);
  });

  it("lists every pack by name when nothing is priced", () => {
    const ranks = rankForPlatinum([BETA, ALPHA], null, max21, () => null);
    expect(ranks.map((rank) => rank.collection)).toEqual(["Alpha", "Beta"]);
    expect(ranks.every((rank) => rank.score === 0 && rank.top === null)).toBe(true);
    expect(names(ranks[0]?.rows ?? [])).toEqual(["A1", "A2", "A3"]);
  });
});

describe("dissolve plan", () => {
  const yields = { "Arcane X": 24, "Arcane Y": 98, "Arcane Z": 28, "Arcane W": 21 };
  const prices: Record<string, number> = { "Arcane X": 5, "Arcane Y": 5, "Arcane Z": 2 };
  const priceOf = (name: string): number | null => prices[name] ?? null;
  const held = holdings({
    "Arcane X": 25,
    "Arcane Y": 30,
    "Arcane Z": 21,
    "Arcane W": 22,
    Other: 50,
  });

  it("keeps a max-rank set back by default", () => {
    const plan = dissolvePlan(held, yields, max21, priceOf, true);
    expect(plan?.rows.map((row) => [row.name, row.spare])).toEqual([
      ["Arcane Y", 9],
      ["Arcane X", 4],
      ["Arcane W", 1],
    ]);
    expect(plan?.spare).toBe(14);
    expect(plan?.total).toBe(9 * 98 + 4 * 24 + 21);
  });

  it("offers every copy with the filter off, cheapest first and unpriced last", () => {
    const plan = dissolvePlan(held, yields, max21, priceOf, false);
    expect(plan?.rows.map((row) => row.name)).toEqual([
      "Arcane Z",
      "Arcane Y",
      "Arcane X",
      "Arcane W",
    ]);
    expect(plan?.rows[0]?.spare).toBe(21);
    expect(plan?.total).toBe(21 * 28 + 30 * 98 + 25 * 24 + 22 * 21);
  });

  it("is unknown without holdings", () => {
    expect(dissolvePlan(null, yields, max21, priceOf, true)).toBeNull();
  });
});
