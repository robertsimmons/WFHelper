import { describe, expect, it } from "vitest";

import {
  overframeIndex,
  overframeUrl,
  overframeUrlIn,
} from "../../../../src/lib/suggest/overframe.js";

// The shape scripts/suggest/fetch-overframe-items.mjs writes.
const FILE = {
  items: {
    "500": {
      slug: "volt-prime",
      name: "Volt Prime",
      uniqueName: "/Lotus/Powersuits/Volt/VoltPrime",
      categories: ["Warframes"],
    },
    "812": { slug: "braton-prime", name: "Braton Prime", uniqueName: null },
  },
};

describe("overframeIndex", () => {
  it("builds an arsenal url from the mapped id and slug", () => {
    const index = overframeIndex(FILE);
    expect(overframeUrlIn(index, "Braton Prime")).toBe(
      "https://overframe.gg/items/arsenal/812/braton-prime/",
    );
  });

  it("matches on uniqueName before the display name", () => {
    const index = overframeIndex({
      items: {
        "500": {
          slug: "volt-prime",
          name: "Volt Prime",
          uniqueName: "/Lotus/Powersuits/Volt/VoltPrime",
        },
        "900": { slug: "volt-prime-skin", name: "Volt Prime" },
      },
    });
    expect(index.get("volt prime")?.id).toBe("500");
    expect(overframeUrlIn(index, "Volt Prime", "/Lotus/Powersuits/Volt/VoltPrime")).toBe(
      "https://overframe.gg/items/arsenal/500/volt-prime/",
    );
  });

  it("ignores case and spacing in the name", () => {
    const index = overframeIndex(FILE);
    expect(overframeUrlIn(index, "  volt   PRIME ")).toBe(
      "https://overframe.gg/items/arsenal/500/volt-prime/",
    );
  });

  it("yields no url for an item the mapping does not name", () => {
    expect(overframeUrlIn(overframeIndex(FILE), "Kuva Bramma")).toBeNull();
    expect(overframeUrlIn(overframeIndex(FILE), null)).toBeNull();
  });

  it("indexes nothing from a missing, empty or malformed file", () => {
    for (const raw of [null, undefined, {}, { items: null }, { items: [] }, "nope", 7]) {
      expect(overframeIndex(raw).size).toBe(0);
    }
  });

  it("skips rows without a usable id or slug", () => {
    const index = overframeIndex({
      items: {
        "12": { name: "No Slug" },
        abc: { slug: "not-numeric", name: "Bad Id" },
        "13": { slug: "   ", name: "Blank Slug" },
        "14": null,
      },
    });
    expect(index.size).toBe(0);
  });
});

describe("overframeUrl", () => {
  // The data build owns overframeItems.json; until it runs there is no file and
  // every lookup must come back empty rather than guessing a url.
  it("never invents a url for an unknown item", () => {
    expect(overframeUrl("Definitely Not An Item")).toBeNull();
  });
});
