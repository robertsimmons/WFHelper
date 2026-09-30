import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain build script module, no type declarations
import * as arcanes from "../../scripts/suggest/arcanes.mjs";

const {
  countedBuilds,
  foldArcaneBuilds,
  modDbChunkUrl,
  needsNextPage,
  parseModDb,
  slottedArcanes,
  webpackRuntimeUrl,
} = arcanes;

const ENERGIZE = "/Lotus/Upgrades/CosmeticEnhancers/Utility/Energize";
const GRACE = "/Lotus/Upgrades/CosmeticEnhancers/Defensive/Grace";
const FURY = "/Lotus/Upgrades/CosmeticEnhancers/Offensive/Fury";

describe("countedBuilds", () => {
  it("keeps the top build and every build over 300 votes", () => {
    const builds = [
      { id: 3, score: 12 },
      { id: 1, score: 900 },
      { id: 2, score: 301 },
      { id: 4, score: 300 },
    ];
    expect(countedBuilds(builds).map((build: { id: number }) => build.id)).toEqual([1, 2]);
  });

  it("keeps a lone low-voted build, since it is still the item's top one", () => {
    expect(countedBuilds([{ id: 7, score: 4 }])).toEqual([{ id: 7, score: 4 }]);
  });

  it("counts nothing for an item with no builds", () => {
    expect(countedBuilds([])).toEqual([]);
  });
});

describe("needsNextPage", () => {
  it("pages on only while the last build still clears the floor", () => {
    expect(needsNextPage({ next: "n", results: [{ score: 900 }, { score: 301 }] })).toBe(true);
    expect(needsNextPage({ next: "n", results: [{ score: 900 }, { score: 300 }] })).toBe(false);
    expect(needsNextPage({ next: null, results: [{ score: 900 }] })).toBe(false);
  });
});

describe("slottedArcanes", () => {
  const byId = new Map([
    [10, ENERGIZE],
    [11, GRACE],
  ]);

  it("reads only the slots holding an arcane, once each", () => {
    const build = { slots: [{ mod: 695 }, { mod: 10 }, { mod: 10 }, { mod: 11 }] };
    expect(slottedArcanes(build, byId)).toEqual([ENERGIZE, GRACE]);
  });

  it("reads nothing off a build with no slots", () => {
    expect(slottedArcanes({}, byId)).toEqual([]);
  });
});

describe("foldArcaneBuilds", () => {
  const names = new Map([
    [ENERGIZE, "Arcane Energize"],
    [GRACE, "Arcane Grace"],
    [FURY, "Arcane Fury"],
  ]);

  it("gives one point per build, most slotted first, and lists the unslotted last", () => {
    const list = foldArcaneBuilds([[ENERGIZE, GRACE], [GRACE], [GRACE, GRACE]], names);
    expect(list).toEqual([
      { name: "Arcane Grace", count: 3, wikiUrl: "https://wiki.warframe.com/w/Arcane_Grace" },
      {
        name: "Arcane Energize",
        count: 1,
        wikiUrl: "https://wiki.warframe.com/w/Arcane_Energize",
      },
      { name: "Arcane Fury", count: 0, wikiUrl: "https://wiki.warframe.com/w/Arcane_Fury" },
    ]);
  });

  it("folds two paths DE gives one name into one entry", () => {
    const twin = "/Lotus/Upgrades/CosmeticEnhancers/Utility/EnergizeCopy";
    const list = foldArcaneBuilds(
      [[ENERGIZE], [twin]],
      new Map([
        [ENERGIZE, "Arcane Energize"],
        [twin, "Arcane Energize"],
      ]),
    );
    expect(list).toEqual([expect.objectContaining({ name: "Arcane Energize", count: 2 })]);
  });
});

describe("the mod database chunk", () => {
  const runtimeUrl = "https://static.overframe.gg/_next/static/chunks/webpack-abc.js";
  const runtime =
    'p.u=function(e){return"static/chunks/"+(({222:"db/variants",7482:"db/mods"})[e]||e)+' +
    '"."+({222:"0ae753665c29f569",17482:"ffff",7482:"e6264c5250fc674f"})[e]+".js"}';

  it("finds the webpack runtime on a page", () => {
    const html = `<script src="${runtimeUrl}" defer=""></script>`;
    expect(webpackRuntimeUrl(html)).toBe(runtimeUrl);
  });

  it("names the chunk file off the runtime's id and hash maps", () => {
    expect(modDbChunkUrl(runtime, runtimeUrl)).toBe(
      "https://static.overframe.gg/_next/static/chunks/db/mods.e6264c5250fc674f.js",
    );
  });

  it("maps Overframe ids to uniqueNames out of the JSON.parse body", () => {
    const body = JSON.stringify({
      [ENERGIZE]: { id: 2207, name: "Arcane Energize", path: ENERGIZE, data: { note: "it's" } },
      bare: { name: "no id" },
    }).replace(/'/g, "\\'");
    const chunk = `(self.x=self.x||[]).push([[7482],{1:function(e){e.exports=JSON.parse('${body}')}}]);`;
    expect([...parseModDb(chunk)]).toEqual([[2207, ENERGIZE]]);
  });
});
