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
  type PlanStep,
} from "../../../src/components/nextup/plan/planSteps.js";
import {
  resolvePlanFor,
  type ResolvedPlan,
} from "../../../src/lib/suggest/acquisition/plan/index.js";
import type { Translator } from "../../../src/lib/i18n.js";
import type { Suggestion } from "../../../src/types/suggest.js";

const t: Translator = (key) => key;
const NOW = Date.parse("2026-10-10T00:00:00Z");
const VOX_SOLARIS = "/Lotus/Types/Keys/SolarisQuest/SolarisQuestKeyChain";

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

/** Bad Baby with Vox Solaris done, so the first step is behind the player. */
function badBaby(): ResolvedPlan {
  const plan = resolvePlanFor(
    { name: "Bad Baby", tier: null },
    {
      itemDb: { [VOX_SOLARIS]: { name: "Vox Solaris", category: "Key" } },
      inventory: { QuestKeys: [{ ItemType: VOX_SOLARIS, Completed: true }] },
      now: NOW,
    },
  );
  if (!plan) throw new Error("no Bad Baby plan");
  return plan;
}

function steps(done: boolean[]): PlanStep[] {
  return done.map((entry, index) => ({ id: String(index), done: entry }) as PlanStep);
}

describe("step counter", () => {
  it("points at the first step still open, wherever it sits", () => {
    expect(stepProgress(steps([true, false, true, false]))).toEqual({ step: 2, total: 4 });
  });

  it("stops at the last step once every step is done", () => {
    expect(stepProgress(steps([true, true]))).toEqual({ step: 2, total: 2 });
  });

  it("reads an empty plan as nothing to do", () => {
    expect(stepProgress([])).toEqual({ step: 0, total: 0 });
  });

  it("names the same step the plan's numbered steps open on", () => {
    const plan = badBaby();
    const drawn = planSteps(plan, { t });
    const first = drawn.findIndex((step) => !step.done);
    expect(first).toBeGreaterThan(0);
    expect(nextStep(plan, false, t)).toEqual({ step: first + 1, total: drawn.length });
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
