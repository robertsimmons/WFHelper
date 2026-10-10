import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { authoredPlan } from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import { resourceEntry } from "../../../../../../src/lib/suggest/acquisition/plan/resources.js";
import {
  authoredTarget,
  generatedTarget,
  storeTarget,
  tipDisputes,
  tipsFiles,
  validateDisputes,
  validateTips,
  type TipsFile,
  type TipsTarget,
} from "../../../../../../src/lib/suggest/acquisition/tips/index.js";

const RELICS = path.resolve(
  __dirname,
  "../../../../../../node_modules/@wfcd/items/data/json/Relics.json",
);

/** Every Prime a relic pays a part of, by name, from the bundled relic table. */
function relicPrimes(): Set<string> {
  const relics = JSON.parse(fs.readFileSync(RELICS, "utf8")) as {
    rewards?: { item?: { name?: string } }[];
  }[];
  const names = new Set<string>();
  for (const relic of relics) {
    for (const reward of relic.rewards ?? []) {
      const match = /^(.+ Prime)\b/.exec(reward.item?.name ?? "");
      if (match) names.add(match[1]);
    }
  }
  return names;
}

const PRIMES = relicPrimes();

function target(name: string): TipsTarget | null {
  const plan = authoredPlan(name);
  if (plan) return authoredTarget(plan);
  if (PRIMES.has(name)) return generatedTarget();
  return resourceEntry(name)?.kind ? storeTarget(name, resourceEntry) : null;
}

function file(tips: TipsFile["tips"], removed: TipsFile["removed"] = []): TipsFile {
  return { name: "Gauss", tips, removed };
}

const FARM = { group: "farm" as const, place: "KAPPA" };

describe("shipped tips", () => {
  it("validates every tips file against its item's plan", () => {
    for (const tips of tipsFiles()) {
      expect([tips.name, validateTips(tips, target)]).toEqual([tips.name, []]);
    }
  });

  it("validates every dispute against the tips files", () => {
    expect(validateDisputes(tipDisputes(), tipsFiles())).toEqual([]);
  });
});

describe("validateTips", () => {
  const tip = (extra: Record<string, unknown> = {}) => ({
    id: "a",
    text: "Stay in after the first C reward.",
    kind: "tactic",
    consensus: "common",
    anchor: FARM,
    ...extra,
  });

  it("names a bad enum, an em dash, a date and a repeated text", () => {
    const value = file([
      tip({ kind: "advice", consensus: "most" }) as never,
      tip({ id: "b", text: "Stay in — always, as of 2026." }) as never,
      tip({ id: "c" }) as never,
    ]);
    expect(validateTips(value, target)).toEqual([
      "tips[0].kind is not a tip kind",
      "tips[0].consensus is not a consensus level",
      "tips[1].text has an em dash",
      'tips[1].text names a date or "currently"',
      "tips[2].text repeats another tip",
    ]);
  });

  it("anchors every non-sentiment tip and never a sentiment one", () => {
    const value = file([
      tip({ anchor: null }) as never,
      tip({ id: "b", text: "Worth it.", kind: "sentiment" }) as never,
    ]);
    expect(validateTips(value, target)).toEqual([
      "tips[0].anchor must name the step the tip is about",
      "tips[1].anchor must be null on a sentiment tip",
    ]);
  });

  it("checks anchors against the plan's groups and rows", () => {
    const value = file([
      tip({ anchor: { group: "boss" } }) as never,
      tip({ id: "b", text: "Two.", anchor: { ...FARM, row: "Nothing Here" } }) as never,
      tip({ id: "c", text: "Three.", anchor: { ...FARM, row: "Chassis" } }) as never,
      tip({ id: "d", text: "Four.", anchor: { group: "farm", route: "afterQuest" } }) as never,
    ]);
    expect(validateTips(value, target)).toEqual([
      "tips[0].anchor matches no group in the plan",
      'tips[1].anchor.row "Nothing Here" matches no row in that group',
      "tips[3].anchor matches no group in the plan",
    ]);
  });

  it("keeps a removed text and its id from coming back", () => {
    const removed = [
      { id: "a", text: "Stay in after the first C reward.", reason: "wrong", wiki: "nope" },
    ];
    expect(validateTips(file([tip() as never], removed), target)).toEqual([
      "removed[0].wiki must be a wiki.warframe.com URL",
      'tips[0].id "a" is used twice',
      "tips[0].text was removed; it cannot come back",
    ]);
  });

  it("anchors a generated Prime by group and place, never by row", () => {
    const value = {
      name: "Ash Prime",
      tips: [
        tip({ anchor: { group: "vendor", place: "MAROO" } }),
        tip({ id: "b", text: "Two.", anchor: { group: "fissure", row: "Ash Prime Systems" } }),
        tip({ id: "c", text: "Three.", anchor: { group: "boss" } }),
      ],
      removed: [],
    };
    expect(validateTips(value, target)).toEqual([
      "tips[1].anchor.row cannot be checked on a generated plan; anchor by group and place",
      "tips[2].anchor matches no group in the plan",
    ]);
  });

  it("rejects a name nothing can plan", () => {
    expect(validateTips({ name: "Not A Real Item", tips: [], removed: [] }, target)).toEqual([
      'name "Not A Real Item" is no authored plan, generated Prime or store key',
    ]);
  });
});

describe("validateDisputes", () => {
  const files = [file([{ id: "a", text: "x", kind: "tactic", consensus: "some", anchor: FARM }])];
  const dispute = {
    item: "Gauss",
    tipId: "a",
    claim: "c",
    wiki: "https://wiki.warframe.com/w/Gauss",
  };

  it("ties an open or dismissed dispute to a live tip", () => {
    expect(validateDisputes([{ ...dispute, status: "open" }], files)).toEqual([]);
    expect(validateDisputes([{ ...dispute, tipId: "z", status: "dismissed" }], files)).toEqual([
      'disputes[0].tipId "z" is no live tip of Gauss',
    ]);
  });

  it("moves a confirmed dispute's tip to removed", () => {
    expect(validateDisputes([{ ...dispute, status: "confirmed" }], files)).toEqual([
      'disputes[0] is confirmed, so tip "a" belongs in removed',
    ]);
  });

  it("never files the same claim twice", () => {
    const open = { ...dispute, status: "open" };
    expect(validateDisputes([open, open], files)).toEqual([
      "disputes[1] files the same claim twice",
    ]);
  });
});
