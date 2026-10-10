import { describe, expect, it } from "vitest";

import {
  authoredPlan,
  resolvePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import {
  placeTips,
  type AnchorGroup,
  type ItemTip,
} from "../../../../../../src/lib/suggest/acquisition/tips/index.js";

function tip(id: string, extra: Partial<ItemTip> = {}): ItemTip {
  return {
    id,
    text: id,
    kind: "tactic",
    consensus: "some",
    anchor: { group: "vendor" },
    dispute: null,
    ...extra,
  };
}

const GROUPS: AnchorGroup[] = [
  { type: "currency", place: "CAMBION DRIFT", rows: [{ label: "Aya" }], route: "chosen" },
  { type: "vendor", place: "MAROO'S BAZAAR, MARS", rows: [{ label: "Axi A7" }], route: "chosen" },
  { type: "vendor", place: "BARO KI'TEER", rows: [{ label: "Neo N5" }], route: "chosen" },
  { type: "farm", place: "CETUS", rows: [{ label: "Rubedo" }], route: null },
  { type: "farm", place: "SIMARIS", rows: [{ label: "Scan" }], route: "afterQuest" },
];

describe("placeTips", () => {
  it("lands each tip on its step by type, place and row, strongest first", () => {
    const placed = placeTips(GROUPS, [
      tip("first-vendor"),
      tip("baro", { anchor: { group: "vendor", place: "baro" } }),
      tip("by-row", { anchor: { group: "vendor", row: "Neo N5" }, consensus: "unanimous" }),
      tip("after", { anchor: { route: "afterQuest", group: "farm" } }),
    ]);
    expect(placed.groups.map((tips) => tips.map((entry) => entry.id))).toEqual([
      [],
      ["first-vendor"],
      ["by-row", "baro"],
      [],
      ["after"],
    ]);
    expect(placed.rest).toEqual([]);
  });

  it("drops no tip: a missing step is plan level, and sentiment stands apart", () => {
    const placed = placeTips(GROUPS, [
      tip("gone", { anchor: { group: "fissure" } }),
      tip("wrong-place", { anchor: { group: "vendor", place: "SIMARIS" } }),
      tip("store-farm", { anchor: { group: "farm", place: "CETUS" } }),
      tip("row-miss", { anchor: { group: "vendor", place: "BARO", row: "Lith Q1" } }),
      tip("worth", { kind: "sentiment", anchor: null }),
    ]);
    expect(placed.rest.map((entry) => entry.id)).toEqual(["gone", "wrong-place", "store-farm"]);
    expect(placed.groups[2].map((entry) => entry.id)).toEqual(["row-miss"]);
    expect(placed.sentiment.map((entry) => entry.id)).toEqual(["worth"]);
  });
});

describe("resolving a plan with tips", () => {
  it("merges the shipped tips into the step they are about", () => {
    const gauss = authoredPlan("Gauss");
    if (!gauss) throw new Error("no Gauss plan");
    const resolved = resolvePlan(gauss, { itemDb: {}, inventory: null });
    const kappa = resolved.groups.find((group) => group.place === "KAPPA, SEDNA");
    expect(kappa?.tips.map((entry) => entry.id)).toContain("keep-conduits");
    expect(resolved.groups.find((group) => group.type === "gate")?.tips[0]?.id).toBe(
      "gems-from-clanmates",
    );
    expect(resolved.tips).toEqual([]);
    expect(resolved.sentiment.map((entry) => entry.kind)).toEqual(["sentiment", "sentiment"]);
  });

  it("carries an open dispute and renders nothing for an item with no tips file", () => {
    const gauss = authoredPlan("Gauss");
    if (!gauss) throw new Error("no Gauss plan");
    const disputed = tip("x", {
      anchor: { group: "farm", place: "KAPPA" },
      dispute: { claim: "c", wiki: "https://wiki.warframe.com/w/Gauss" },
    });
    const resolved = resolvePlan(gauss, { itemDb: {}, inventory: null, tips: () => [disputed] });
    expect(resolved.groups.find((group) => group.type === "farm")?.tips).toEqual([disputed]);
    const none = resolvePlan(gauss, { itemDb: {}, inventory: null, tips: () => [] });
    expect(none.groups.every((group) => group.tips.length === 0)).toBe(true);
    expect([none.tips, none.sentiment]).toEqual([[], []]);
  });
});
