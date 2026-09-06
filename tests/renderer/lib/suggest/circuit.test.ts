import { describe, expect, it } from "vitest";

import { gradeClass } from "../../../../src/lib/suggest/circuit.js";

describe("gradeClass", () => {
  it("gives each tier its own colour", () => {
    expect(gradeClass("S")).toBe("text-[var(--relic-requiem)]");
    expect(gradeClass("A")).toBe("text-success");
    expect(gradeClass("B")).toBe("text-warning");
    expect(gradeClass("C")).toBe("text-danger");
  });

  it("colours a suffixed grade as its letter", () => {
    expect(gradeClass("S+")).toBe(gradeClass("S"));
    expect(gradeClass("A-")).toBe(gradeClass("A"));
    expect(gradeClass("b+")).toBe(gradeClass("B"));
  });

  it("falls back to muted for an unrated or missing grade", () => {
    expect(gradeClass(undefined)).toBe("text-text-muted");
    expect(gradeClass(null)).toBe("text-text-muted");
    expect(gradeClass("")).toBe("text-text-muted");
    expect(gradeClass("Z")).toBe("text-text-muted");
  });
});
