import { describe, expect, it } from "vitest";

import {
  createRatings,
  UNKNOWN_DIFFICULTY,
} from "../../../../../src/lib/suggest/acquisition/ratings.js";

describe("createRatings", () => {
  it("falls back to the shipped warframe table when no ratings are supplied", () => {
    const ratings = createRatings();
    expect(ratings.difficultyLabel("Volt")).toBe("easy");
    expect(ratings.difficulty("Volt")).toBeLessThan(UNKNOWN_DIFFICULTY);
    expect(ratings.difficulty("Mag")).toBe(UNKNOWN_DIFFICULTY);
  });

  it("reports unknown for a name nothing has rated", () => {
    const ratings = createRatings();
    expect(ratings.difficulty("Nonesuch")).toBeNull();
    expect(ratings.difficultyLabel("Nonesuch")).toBeNull();
    expect(ratings.rank("Nonesuch")).toBeNull();
    expect(ratings.popularity("Nonesuch")).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "not a table"],
    ["an array", [1, 2, 3]],
    ["a number", 7],
  ])("tolerates %s in place of a ratings table", (_label, table) => {
    const ratings = createRatings(table);
    expect(ratings.rank("Mag")).toBeNull();
    expect(ratings.popularity("Mag")).toBeNull();
    expect(ratings.difficulty("Mag")).toBe(UNKNOWN_DIFFICULTY);
  });

  it("tolerates a null entry and wrong-typed fields", () => {
    const ratings = createRatings({
      Mag: null,
      Volt: { difficulty: {}, rank: 42, popularity: "high" },
    });
    expect(ratings.rank("Volt")).toBeNull();
    expect(ratings.popularity("Volt")).toBeNull();
    expect(ratings.difficultyLabel("Volt")).toBe("easy");
  });

  it("reads a supplied difficulty as a word or a number", () => {
    const ratings = createRatings({ Mag: { difficulty: "hard" }, Volt: { difficulty: 0.9 } });
    expect(ratings.difficulty("Mag")).toBeGreaterThan(UNKNOWN_DIFFICULTY);
    expect(ratings.difficulty("Volt")).toBe(0.9);
  });

  it("clamps a supplied number into the unit interval", () => {
    const ratings = createRatings({ Mag: { difficulty: 4, popularity: -3 } });
    expect(ratings.difficulty("Mag")).toBe(1);
    expect(ratings.popularity("Mag")).toBe(0);
  });

  it("lets a supplied rating win over the shipped word", () => {
    const shipped = createRatings();
    const supplied = createRatings({ Volt: { difficulty: "brutal", rank: "S" } });
    expect(shipped.difficulty("Volt")).toBeLessThan(supplied.difficulty("Volt") as number);
    expect(supplied.rank("Volt")).toBe("S");
  });

  it("matches names through the table's ampersand spelling", () => {
    const ratings = createRatings({ "Sirius & Orion": { rank: "A" } });
    expect(ratings.rank("Sirius And Orion")).toBe("A");
  });
});
