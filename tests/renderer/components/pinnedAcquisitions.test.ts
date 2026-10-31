import { describe, expect, it } from "vitest";

import {
  acquisitionKey,
  nextStep,
  pinnedAcquisitions,
  withoutPinned,
} from "../../../src/components/nextup/pinnedAcquisitions.js";
import {
  planSteps,
  stepProgress,
  type PlanLine,
  type PlanModel,
} from "../../../src/components/nextup/plan/planSteps.js";
import {
  resolvePlanFor,
  type ResolvedPlan,
} from "../../../src/lib/suggest/acquisition/plan/index.js";
import type { Translator } from "../../../src/lib/i18n.js";
import type { Suggestion } from "../../../src/types/suggest.js";

const t: Translator = (key) => key;
const NOW = Date.parse("2026-10-10T00:00:00Z");

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

function resolveBadBaby(manualDone: readonly string[]): ResolvedPlan {
  const plan = resolvePlanFor(
    { name: "Bad Baby", tier: null },
    { itemDb: {}, inventory: null, manualDone, now: NOW },
  );
  if (!plan) throw new Error("no Bad Baby plan");
  return plan;
}

/** Bad Baby with its first line ticked, so that line is behind the player. */
function badBaby(): ResolvedPlan {
  const first = openLines(planSteps(resolveBadBaby([]), { t }))[0];
  if (!first) throw new Error("Bad Baby draws no lines");
  return resolveBadBaby(first.rowIds);
}

function openLines(model: PlanModel): PlanLine[] {
  return model.sections.flatMap((section) =>
    section.entries.flatMap((entry) => (entry.kind === "trip" ? entry.lines : [entry])),
  );
}

function model(open: number, done: number): PlanModel {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: String(index) }) as PlanLine);
  return {
    sections: open > 0 ? [{ key: "farm", entries: lines(open) }] : [],
    done: lines(done),
    shop: null,
    copies: 1,
  };
}

describe("step counter", () => {
  it("points at the first line still open, after every line done", () => {
    expect(stepProgress(model(2, 2))).toEqual({ step: 3, total: 4 });
  });

  it("counts every line a trip carries", () => {
    const trip = model(0, 1);
    trip.sections = [
      {
        key: "farm",
        entries: [{ kind: "trip", id: "t", place: "P", lines: model(0, 2).done, next: true }],
      },
    ];
    expect(stepProgress(trip)).toEqual({ step: 2, total: 3 });
  });

  it("stops at the last line once every line is done", () => {
    expect(stepProgress(model(0, 2))).toEqual({ step: 2, total: 2 });
  });

  it("reads an empty plan as nothing to do", () => {
    expect(stepProgress(model(0, 0))).toEqual({ step: 0, total: 0 });
  });

  it("names the line the plan marks next, after the ticked one", () => {
    const plan = badBaby();
    const drawn = planSteps(plan, { t });
    expect(drawn.done.length).toBeGreaterThan(0);
    const next = openLines(drawn).find((entry) => entry.next);
    expect(next?.done).toBe(false);
    expect(nextStep(plan, t)).toEqual({
      step: drawn.done.length + 1,
      total: drawn.done.length + openLines(drawn).length,
    });
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

  it("counts the steps the plan page draws for that item", () => {
    const plan = badBaby();
    const [entry] = pinnedAcquisitions(["/a"], [suggestion("/a")], { "/a": plan }, t);
    expect(entry?.steps).toEqual(stepProgress(planSteps(plan, { t })));
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
