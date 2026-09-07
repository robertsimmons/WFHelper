import { describe, expect, it } from "vitest";

import {
  createProgenitors,
  progenitors,
} from "../../../../../src/lib/suggest/acquisition/progenitors.js";

describe("createProgenitors", () => {
  it("groups the Warframes under the element each one rolls", () => {
    const rows = createProgenitors({ Ember: "Heat", Chroma: "Heat", Volt: "Electricity" });
    expect(rows).toEqual([
      { element: "Heat", warframes: ["Chroma", "Ember"] },
      { element: "Electricity", warframes: ["Volt"] },
    ]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "not a table"],
    ["an array", ["Ember"]],
    ["a number", 7],
  ])("tolerates %s in place of the progenitor file", (_label, source) => {
    expect(createProgenitors(source)).toEqual([]);
  });

  it("drops a row whose element is not a name", () => {
    expect(createProgenitors({ Ember: 3, Volt: "", Mag: "Magnetic" })).toEqual([
      { element: "Magnetic", warframes: ["Mag"] },
    ]);
  });
});

describe("the shipped progenitors", () => {
  it("names the Warframe that rolls each element", () => {
    const heat = progenitors.find((row) => row.element === "Heat");
    expect(heat?.warframes).toContain("Ember");
    expect(progenitors.length).toBeGreaterThan(1);
  });
});
