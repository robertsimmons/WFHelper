import { describe, expect, it } from "vitest";

import { tierOrder, tierScore } from "../../../../../src/lib/suggest/acquisition/recommend.js";

describe("tierScore", () => {
  it("puts the better letter lower, so it sorts first", () => {
    expect(tierScore("S")).toBeLessThan(tierScore("A") as number);
    expect(tierScore("B")).toBeLessThan(tierScore("D") as number);
  });

  it("reports unknown for a letter nothing recognises", () => {
    expect(tierScore(null)).toBeNull();
    expect(tierScore("Z")).toBeNull();
  });

  it("orders two items inside one letter by the average behind it", () => {
    expect(tierScore("B", 2.6)).toBeLessThan(tierScore("B", 3.4) as number);
    expect(tierScore("B", 2.6)).toBeGreaterThan(tierScore("A") as number);
  });

  it("keeps the letter's own place when the average rates something else", () => {
    expect(tierScore("S", 4.2)).toBe(tierScore("S"));
    expect(tierScore("A", 0)).toBe(tierScore("A"));
    expect(tierScore("D", Number.NaN)).toBe(tierScore("D"));
  });

  it("reads a lowercase letter", () => {
    expect(tierScore("s")).toBe(tierScore("S"));
  });
});

describe("tierOrder", () => {
  it("puts the better tier first", () => {
    expect(tierOrder("S")).toBeLessThan(tierOrder("A") as number);
    expect(tierOrder("A")).toBeLessThan(tierOrder("D") as number);
  });

  it("reports unknown rather than a middling place", () => {
    expect(tierOrder(null)).toBeNull();
    expect(tierOrder("Z")).toBeNull();
  });
});
