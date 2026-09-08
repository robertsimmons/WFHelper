import { describe, expect, it } from "vitest";

import { curated } from "../../../../../src/lib/suggest/acquisition/curated.js";
import {
  createRatings,
  UNKNOWN_EFFORT,
} from "../../../../../src/lib/suggest/acquisition/ratings.js";

describe("createRatings", () => {
  it("falls back to the shipped warframe table when no ratings are supplied", () => {
    const ratings = createRatings();
    expect(ratings.effortLabel("Volt")).toBe("easy");
    expect(ratings.effort("Volt")).toBeLessThan(UNKNOWN_EFFORT);
    expect(ratings.effort("Mag")).toBe(UNKNOWN_EFFORT);
  });

  it("reports unknown for a name nothing has rated", () => {
    const ratings = createRatings();
    expect(ratings.effort("Nonesuch")).toBeNull();
    expect(ratings.effortLabel("Nonesuch")).toBeNull();
    expect(ratings.tier("Nonesuch")).toBeNull();
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
    expect(ratings.tier("Nonesuch")).toBeNull();
    expect(ratings.popularity("Mag")).toBeNull();
    expect(ratings.effort("Mag")).toBe(UNKNOWN_EFFORT);
  });

  it("tolerates a null entry and wrong-typed fields", () => {
    const ratings = createRatings({
      Mag: null,
      Nonesuch: { difficulty: {}, rank: 42, popularity: "high" },
      Volt: { difficulty: {}, rank: 42, popularity: "high" },
    });
    expect(ratings.tier("Nonesuch")).toBeNull();
    expect(ratings.popularity("Volt")).toBeNull();
    expect(ratings.effortLabel("Volt")).toBe("easy");
  });

  it("reads a supplied difficulty as a word or a number", () => {
    const ratings = createRatings({ Mag: { difficulty: "hard" }, Volt: { difficulty: 0.9 } });
    expect(ratings.effort("Mag")).toBeGreaterThan(UNKNOWN_EFFORT);
    expect(ratings.effort("Volt")).toBe(0.9);
  });

  it("clamps a supplied number into the unit interval", () => {
    const ratings = createRatings({ Mag: { difficulty: 4, popularity: -3 } });
    expect(ratings.effort("Mag")).toBe(1);
    expect(ratings.popularity("Mag")).toBe(0);
  });

  it("lets a supplied rating win over the shipped word", () => {
    const shipped = createRatings();
    const supplied = createRatings({ Volt: { difficulty: "brutal", rank: "S" } });
    expect(shipped.effort("Volt")).toBeLessThan(supplied.effort("Volt") as number);
    expect(supplied.tier("Volt")).toBe("S");
  });

  it("matches names through the table's ampersand spelling", () => {
    const ratings = createRatings({ "Sirius & Orion": { rank: "A" } });
    expect(ratings.tier("Sirius And Orion")).toBe("A");
  });

  it("falls back to the shipped overframe tier when no rank is supplied", () => {
    expect(createRatings().tier("Saryn")).toMatch(/^[SABCD]$/);
  });

  it("lets a supplied rank win over the shipped tier", () => {
    const ratings = createRatings({ Saryn: { rank: "Z" } }, curated, () => "B");
    expect(ratings.tier("Saryn")).toBe("Z");
    expect(ratings.tier("Volt")).toBe("B");
  });
});
