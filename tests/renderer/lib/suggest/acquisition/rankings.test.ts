import { describe, expect, it } from "vitest";

import { createRankTiers, rankTiers } from "../../../../../src/lib/suggest/acquisition/rankings.js";

const TIER = /^[SABCD]$/;

const table = {
  fetchedAt: "2026-09-06T23:19:25.673Z",
  categories: { "0": "Warframes", "1": "Primaries" },
  items: {
    saryn: {
      name: "Saryn",
      category: "Warframes",
      categoryId: 0,
      averageScore: 1.24,
      votes: 22456,
    },
    "saryn prime": {
      name: "Saryn Prime",
      category: "Warframes",
      categoryId: 0,
      averageScore: 3.9,
      votes: 27,
    },
    nezha: { name: "Nezha", category: "Warframes", categoryId: 0, averageScore: 2.1, votes: 4000 },
    braton: {
      name: "Braton",
      category: "Primaries",
      categoryId: 1,
      averageScore: 4.64,
      votes: 796,
    },
    "braton prime": {
      name: "Braton Prime",
      category: "Primaries",
      categoryId: 1,
      averageScore: 2.69,
      votes: 1019,
    },
    boltor: { name: "Boltor", category: "Primaries", categoryId: 1, averageScore: 3.2, votes: 500 },
    "ack & brunt": { name: "Ack & Brunt", category: "Melee", categoryId: 3, averageScore: 3.2 },
  },
};

describe("createRankTiers", () => {
  it("reads the tier letter off the average score, best score first", () => {
    const tiers = createRankTiers(table);
    expect(tiers("Saryn")).toBe("S");
    expect(tiers("Nezha")).toBe("A");
    expect(tiers("Braton")).toBe("D");
  });

  it("gives a Warframe Prime the tier of its base frame", () => {
    const tiers = createRankTiers(table);
    expect(tiers("Saryn Prime")).toBe("S");
  });

  it("gives a Warframe Prime with no row of its own the base frame's tier", () => {
    const tiers = createRankTiers(table);
    expect(tiers("Nezha Prime")).toBe("A");
  });

  it("keeps a weapon Prime's own tier apart from its base weapon's", () => {
    const tiers = createRankTiers(table);
    expect(tiers("Braton Prime")).toBe("B");
    expect(tiers("Braton")).toBe("D");
  });

  it("leaves an unrated weapon Prime unranked rather than borrowing the base", () => {
    const tiers = createRankTiers(table);
    expect(tiers("Boltor Prime")).toBeNull();
    expect(tiers("Boltor")).toBe("B");
  });

  it("matches names through the table's ampersand spelling", () => {
    expect(createRankTiers(table)("Ack And Brunt")).toBe("B");
  });

  it("reports unknown for a name the table never lists", () => {
    expect(createRankTiers(table)("Nonesuch")).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "not a table"],
    ["an array", [1, 2, 3]],
    ["a number", 7],
    ["an object with no items", { fetchedAt: "now" }],
    ["items as an array", { items: [{ name: "Saryn", averageScore: 1 }] }],
  ])("tolerates %s in place of the rankings file", (_label, source) => {
    expect(createRankTiers(source)("Saryn")).toBeNull();
  });

  it.each([
    ["a null row", null],
    ["a missing score", { name: "Saryn", categoryId: 0 }],
    ["a wrong-typed score", { name: "Saryn", categoryId: 0, averageScore: "1.24" }],
    ["a non-finite score", { name: "Saryn", categoryId: 0, averageScore: Number.NaN }],
    ["a zero score", { name: "Saryn", categoryId: 0, averageScore: 0 }],
  ])("tolerates %s", (_label, row) => {
    expect(createRankTiers({ items: { saryn: row } })("Saryn")).toBeNull();
  });

  it("clamps a score past the bottom tier rather than falling off the table", () => {
    const tiers = createRankTiers({ items: { saryn: { categoryId: 0, averageScore: 9 } } });
    expect(tiers("Saryn")).toBe("D");
  });
});

describe("the shipped rankings", () => {
  it("rates a frame the overframe tier list knows", () => {
    expect(rankTiers("Saryn")).toMatch(TIER);
  });

  it("reads a Warframe Prime as its base frame", () => {
    expect(rankTiers("Saryn Prime")).toBe(rankTiers("Saryn"));
    expect(rankTiers("Excalibur Prime")).toBe(rankTiers("Excalibur"));
  });

  it("rates a weapon Prime in its own right", () => {
    expect(rankTiers("Braton Prime")).toMatch(TIER);
  });

  it("reports unknown for a name it has never heard of", () => {
    expect(rankTiers("Nonesuch")).toBeNull();
  });
});
