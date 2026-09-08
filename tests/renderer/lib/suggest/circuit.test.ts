import { describe, expect, it } from "vitest";

import { tierClass } from "../../../../src/lib/suggest/circuit.js";

describe("tierClass", () => {
  it("gives each tier its own colour", () => {
    expect(tierClass("S")).toBe("text-[var(--relic-requiem)]");
    expect(tierClass("A")).toBe("text-success");
    expect(tierClass("B")).toBe("text-warning");
    expect(tierClass("C")).toBe("text-danger");
  });

  it("colours a suffixed tier as its letter", () => {
    expect(tierClass("S+")).toBe(tierClass("S"));
    expect(tierClass("A-")).toBe(tierClass("A"));
    expect(tierClass("b+")).toBe(tierClass("B"));
  });

  it("falls back to muted for an unrated or missing tier", () => {
    expect(tierClass(undefined)).toBe("text-text-muted");
    expect(tierClass(null)).toBe("text-text-muted");
    expect(tierClass("")).toBe("text-text-muted");
    expect(tierClass("Z")).toBe("text-text-muted");
  });
});
