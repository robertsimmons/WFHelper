import { describe, expect, it } from "vitest";

import {
  acquisitionKey,
  nextStep,
  pinnedAcquisitions,
  stepCount,
  withoutPinned,
  type PlanSteps,
} from "../../../src/components/nextup/pinnedAcquisitions.js";
import type { Suggestion } from "../../../src/types/suggest.js";

function suggestion(uniqueName: string | null, name = "Rhino"): Suggestion {
  return {
    id: `acquisition:${uniqueName ?? name}`,
    category: "acquisition",
    title: `Build ${name}`,
    why: "",
    ...(uniqueName === null ? {} : { reward: { name, uniqueName } }),
    signals: { value: 1, effort: 0, urgency: 0 },
    score: 1,
    fingerprint: uniqueName ?? name,
  };
}

const PLAN: PlanSteps = {
  groups: [
    { rows: [{ done: true }, { done: false }] },
    { rows: [{ done: true }, {}, { done: false }] },
  ],
};

describe("step counter", () => {
  it("counts every row of every group", () => {
    expect(stepCount(PLAN)).toEqual({ done: 2, total: 5 });
  });

  it("reads an empty plan as nothing to do", () => {
    expect(stepCount({ groups: [] })).toEqual({ done: 0, total: 0 });
  });

  it("points at the first row still open", () => {
    expect(nextStep({ done: 2, total: 5 })).toBe(3);
  });

  it("stops at the last step once every row is ticked", () => {
    expect(nextStep({ done: 5, total: 5 })).toBe(5);
  });
});

describe("pinned acquisitions", () => {
  it("reads in pin order, not feed order", () => {
    const feed = [suggestion("/b", "Mesa"), suggestion("/a", "Rhino")];
    expect(pinnedAcquisitions(["/a", "/b"], feed).map((entry) => entry.uniqueName)).toEqual([
      "/a",
      "/b",
    ]);
  });

  it("draws nothing for a pin the current sweep does not carry", () => {
    expect(pinnedAcquisitions(["/a", "/gone"], [suggestion("/a")])).toHaveLength(1);
  });

  it("leaves the step count unknown until a plan is resolved", () => {
    const [entry] = pinnedAcquisitions(["/a"], [suggestion("/a")]);
    expect(entry?.steps).toBeNull();
  });

  it("counts the steps of the plan for that item", () => {
    const [entry] = pinnedAcquisitions(["/a"], [suggestion("/a")], { "/a": PLAN });
    expect(entry?.steps).toEqual({ done: 2, total: 5 });
  });

  it("names a pin by the uniqueName the resolver used", () => {
    expect(acquisitionKey(suggestion("/a"))).toBe("/a");
    expect(acquisitionKey(suggestion(null))).toBeNull();
  });
});

describe("the list a pinned item leaves", () => {
  it("holds back only the pinned items", () => {
    const feed = [suggestion("/a"), suggestion("/b"), suggestion(null, "Unplaceable")];
    expect(withoutPinned(feed, ["/a"]).map((entry) => entry.id)).toEqual([
      "acquisition:/b",
      "acquisition:Unplaceable",
    ]);
  });

  it("returns an unpinned item to the list", () => {
    const feed = [suggestion("/a")];
    expect(withoutPinned(feed, [])).toHaveLength(1);
  });
});
