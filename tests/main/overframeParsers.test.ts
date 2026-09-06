import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain build script module, no type declarations
import * as overframe from "../../scripts/suggest/overframe.mjs";

const {
  buildRankings,
  extractNextData,
  normalizeIngredients,
  normalizeName,
  parseItemPage,
  parseSitemap,
} = overframe;

const nextData = (pageProps: unknown): string =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps },
  })}</script></body></html>`;

describe("extractNextData", () => {
  it("reads the payload out of the page", () => {
    expect(extractNextData(nextData({ item: { name: "Octavia" } }))).toEqual({
      item: { name: "Octavia" },
    });
  });

  it("returns null for a page with no payload", () => {
    expect(extractNextData("<html><body>nothing here</body></html>")).toBeNull();
  });

  it("returns null when the page leaves its props to the client", () => {
    expect(extractNextData(nextData({}))).toBeNull();
  });

  it("ignores other json script tags", () => {
    const html =
      `<script type="application/ld+json">{"@type":"WebPage"}</script>` +
      nextData({ item: { name: "Wrath" } });
    expect(extractNextData(html)).toEqual({ item: { name: "Wrath" } });
  });
});

describe("parseSitemap", () => {
  const xml = `<urlset>
    <url><loc>https://overframe.gg/</loc></url>
    <url><loc>https://overframe.gg/builds/warframes/</loc></url>
    <url><loc>https://overframe.gg/items/arsenal/10/octavia/</loc><lastmod>2026-07-31T19:02:51.443067+00:00</lastmod></url>
    <url><loc>https://overframe.gg/items/arsenal/5563/tenet-grigori/</loc></url>
    <url><loc>https://overframe.gg/items/arsenal/10/octavia/</loc><lastmod>2026-08-01T00:00:00+00:00</lastmod></url>
  </urlset>`;

  it("keeps only arsenal item urls", () => {
    expect(parseSitemap(xml).map((entry: { slug: string }) => entry.slug)).toEqual([
      "octavia",
      "tenet-grigori",
    ]);
  });

  it("carries the id, slug and lastmod", () => {
    expect(parseSitemap(xml)[0]).toEqual({
      id: 10,
      slug: "octavia",
      lastmod: "2026-07-31T19:02:51.443067+00:00",
    });
  });

  it("leaves lastmod null when the entry has none", () => {
    expect(parseSitemap(xml)[1].lastmod).toBeNull();
  });

  it("returns nothing for an empty sitemap", () => {
    expect(parseSitemap("<urlset></urlset>")).toEqual([]);
  });
});

describe("normalizeIngredients", () => {
  const raw = [
    {
      item: { id: 2986, locTag: "/Lotus/Language/Menu/CraftingComponent_OctaviaHelmetName" },
      count: 1,
      sources: [
        { source: "Deimos/Terrorem (Survival), Rotation C", chance: 0.2256, rarity: "UNCOMMON" },
      ],
      sourceCount: 1,
    },
    { item: { id: 2993, locTag: "/Lotus/Language/BardQuest/Unknown" }, count: 3, sources: [] },
  ];
  const resolve = (locTag: string) =>
    locTag === "/Lotus/Language/Menu/CraftingComponent_OctaviaHelmetName"
      ? "Octavia Neuroptics"
      : null;

  it("resolves the localization tag to a name", () => {
    expect(normalizeIngredients(raw, resolve)[0]).toEqual({
      name: "Octavia Neuroptics",
      locTag: "/Lotus/Language/Menu/CraftingComponent_OctaviaHelmetName",
      count: 1,
      sources: [
        { source: "Deimos/Terrorem (Survival), Rotation C", chance: 0.2256, rarity: "UNCOMMON" },
      ],
    });
  });

  it("keeps an unresolved ingredient with a null name", () => {
    expect(normalizeIngredients(raw, resolve)[1]).toMatchObject({
      name: null,
      count: 3,
      sources: [],
    });
  });

  it("returns nothing when the page has no recipe", () => {
    expect(normalizeIngredients(undefined, resolve)).toEqual([]);
  });
});

describe("parseItemPage", () => {
  const html = nextData({
    item: {
      id: 10,
      name: "Octavia",
      path: "/Lotus/Powersuits/Bard/Bard",
      tag: "Warframe",
      categories: ["warframe"],
    },
    topMods: [{ name: "Stretch" }, { name: "Primed Continuity" }],
    blueprintIngredients: [],
    buildCount: 4321,
  });

  it("keeps the identity, mod order and recipe", () => {
    expect(parseItemPage(html, () => null)).toEqual({
      id: 10,
      name: "Octavia",
      uniqueName: "/Lotus/Powersuits/Bard/Bard",
      tag: "Warframe",
      categories: ["warframe"],
      topMods: ["Stretch", "Primed Continuity"],
      ingredients: [],
    });
  });

  it("returns null for a page with no item", () => {
    expect(parseItemPage(nextData({ topMods: [] }), () => null)).toBeNull();
  });
});

describe("buildRankings", () => {
  const categories = [
    { id: 0, title: "Warframes" },
    { id: 6, title: "Abilities" },
  ];
  const votes = {
    0: [
      { item_id: 10, average_score: 1.35, total: 18112 },
      { item_id: 2525, average_score: 1.21, total: 22082 },
    ],
    6: [{ item_id: 900, average_score: 1.1, total: 500 }],
  };
  const describe_ = (id: number) =>
    id === 10
      ? { name: "Octavia", slug: "octavia" }
      : id === 2525
        ? { name: "Wisp", slug: "wisp" }
        : null;

  it("keys a named item by its normalized name", () => {
    expect(buildRankings(categories, votes, describe_).octavia).toEqual({
      id: 10,
      name: "Octavia",
      slug: "octavia",
      category: "Warframes",
      categoryId: 0,
      averageScore: 1.35,
      votes: 18112,
    });
  });

  it("falls back to an id key when nothing can name the item", () => {
    expect(buildRankings(categories, votes, describe_)["#900"]).toMatchObject({
      id: 900,
      name: null,
      category: "Abilities",
    });
  });

  it("sorts the keys", () => {
    expect(Object.keys(buildRankings(categories, votes, describe_))).toEqual([
      "#900",
      "octavia",
      "wisp",
    ]);
  });

  it("keeps the more voted row when two categories share a name", () => {
    const shared = {
      0: [{ item_id: 10, average_score: 1.35, total: 18112 }],
      6: [{ item_id: 900, average_score: 1.1, total: 500 }],
    };
    const named = () => ({ name: "Octavia", slug: "octavia" });
    expect(buildRankings(categories, shared, named).octavia).toMatchObject({
      id: 10,
      votes: 18112,
    });
  });
});

describe("normalizeName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeName("  Tenet   Grigori ")).toBe("tenet grigori");
  });
});
