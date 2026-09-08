import { describe, expect, it } from "vitest";

import { createItemTiers, itemTiers } from "../../../../../src/lib/suggest/acquisition/tiers.js";

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
    "<archwing> rathbone": {
      name: "<ARCHWING> Rathbone",
      category: "Archwing",
      categoryId: 4,
      averageScore: 4.16,
    },
    "<archwing> odonata": {
      name: "<ARCHWING> Odonata",
      category: "Archwing",
      categoryId: 4,
      averageScore: 2.1,
    },
    "<archwing> odonata prime": {
      name: "<ARCHWING> Odonata Prime",
      category: "Archwing",
      categoryId: 4,
      averageScore: 3,
    },
  },
};

describe("createItemTiers", () => {
  it("reads the tier letter off the average score, best score first", () => {
    const tiers = createItemTiers(table);
    expect(tiers("Saryn")).toBe("S");
    expect(tiers("Nezha")).toBe("A");
    expect(tiers("Braton")).toBe("D");
  });

  it("gives a Warframe Prime the tier of its base frame", () => {
    const tiers = createItemTiers(table);
    expect(tiers("Saryn Prime")).toBe("S");
  });

  it("gives a Warframe Prime with no row of its own the base frame's tier", () => {
    const tiers = createItemTiers(table);
    expect(tiers("Nezha Prime")).toBe("A");
  });

  it("keeps a weapon Prime's own tier apart from its base weapon's", () => {
    const tiers = createItemTiers(table);
    expect(tiers("Braton Prime")).toBe("B");
    expect(tiers("Braton")).toBe("D");
  });

  it("leaves an unrated weapon Prime unranked rather than borrowing the base", () => {
    const tiers = createItemTiers(table);
    expect(tiers("Boltor Prime")).toBeNull();
    expect(tiers("Boltor")).toBe("B");
  });

  it("matches names through the table's ampersand spelling", () => {
    expect(createItemTiers(table)("Ack And Brunt")).toBe("B");
  });

  it("reports unknown for a name the table never lists", () => {
    expect(createItemTiers(table)("Nonesuch")).toBeNull();
  });

  it("matches an archwing through the icon markup its key still carries", () => {
    const tiers = createItemTiers(table);
    expect(tiers("Rathbone")).toBe("C");
    expect(tiers("Odonata Prime")).toBe("B");
    // Archwing, not a Warframe, so the Prime keeps its own row.
    expect(tiers("Odonata")).toBe("A");
    expect(tiers("<ARCHWING> Rathbone")).toBe("C");
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
    expect(createItemTiers(source)("Saryn")).toBeNull();
  });

  it.each([
    ["a null row", null],
    ["a missing score", { name: "Saryn", categoryId: 0 }],
    ["a wrong-typed score", { name: "Saryn", categoryId: 0, averageScore: "1.24" }],
    ["a non-finite score", { name: "Saryn", categoryId: 0, averageScore: Number.NaN }],
    ["a zero score", { name: "Saryn", categoryId: 0, averageScore: 0 }],
  ])("tolerates %s", (_label, row) => {
    expect(createItemTiers({ items: { saryn: row } })("Saryn")).toBeNull();
  });

  it("clamps a score past the bottom tier rather than falling off the table", () => {
    const tiers = createItemTiers({ items: { saryn: { categoryId: 0, averageScore: 9 } } });
    expect(tiers("Saryn")).toBe("D");
  });
});

describe("the shipped rankings", () => {
  it("rates a frame the overframe tier list knows", () => {
    expect(itemTiers("Saryn")).toMatch(TIER);
  });

  it("reads a Warframe Prime as its base frame", () => {
    expect(itemTiers("Saryn Prime")).toBe(itemTiers("Saryn"));
    expect(itemTiers("Excalibur Prime")).toBe(itemTiers("Excalibur"));
  });

  it("rates a weapon Prime in its own right", () => {
    expect(itemTiers("Braton Prime")).toMatch(TIER);
  });

  it("rates the archwings the file stores under a markup-prefixed key", () => {
    expect(itemTiers("Rathbone")).toMatch(TIER);
    expect(itemTiers("Odonata Prime")).toMatch(TIER);
  });

  it("reports unknown for a name it has never heard of", () => {
    expect(itemTiers("Nonesuch")).toBeNull();
  });
});
