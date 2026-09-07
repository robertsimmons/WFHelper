import { describe, expect, it } from "vitest";

import {
  recommendScore,
  tierOrder,
  tierPoints,
} from "../../../../../src/lib/suggest/acquisition/recommend.js";

describe("recommendScore", () => {
  it("ranks a really easy A-tier above a very hard S-tier", () => {
    expect(recommendScore("A", "easy")).toBeGreaterThan(recommendScore("S", "brutal"));
    expect(recommendScore("A", "trivial")).toBeGreaterThan(recommendScore("S", "hard"));
  });

  it("keeps the better tier ahead at the same difficulty", () => {
    expect(recommendScore("S", "hard")).toBeGreaterThan(recommendScore("A", "hard"));
    expect(recommendScore("B", "easy")).toBeGreaterThan(recommendScore("D", "easy"));
  });

  it("keeps the easier farm ahead at the same tier", () => {
    expect(recommendScore("B", "easy")).toBeGreaterThan(recommendScore("B", "brutal"));
  });

  it("scores an unknown tier as the middle letter rather than the bottom", () => {
    expect(recommendScore(null, "easy")).toBe(recommendScore("B", "easy"));
    expect(recommendScore(null, "easy")).toBeGreaterThan(recommendScore("D", "easy"));
    expect(recommendScore(null, "easy")).toBeLessThan(recommendScore("S", "easy"));
  });

  it("scores an unknown difficulty as a normal farm rather than a grim one", () => {
    expect(recommendScore("A", null)).toBe(recommendScore("A", "normal"));
    expect(recommendScore("A", null)).toBeGreaterThan(recommendScore("A", "brutal"));
    expect(recommendScore("A", null)).toBeLessThan(recommendScore("A", "easy"));
  });

  it("leaves an item nothing has rated squarely in the middle", () => {
    expect(recommendScore(null, null)).toBe(recommendScore("B", "normal"));
  });

  it("reads a difficulty supplied as a number", () => {
    expect(recommendScore("A", 0.9)).toBeLessThan(recommendScore("A", 0.1));
  });

  it("treats a tier letter it has never heard of as unrated", () => {
    expect(tierPoints("Z")).toBe(tierPoints(null));
    expect(recommendScore("Z", "easy")).toBe(recommendScore(null, "easy"));
  });

  it("reads a lowercase tier letter", () => {
    expect(recommendScore("s", "easy")).toBe(recommendScore("S", "easy"));
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
