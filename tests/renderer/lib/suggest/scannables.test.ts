import { describe, expect, it } from "vitest";

import {
  loreFragmentScans,
  missingScannables,
  scannableSuggestions,
  type LoreScan,
  type MissingScannables,
  type ScannableCategory,
} from "../../../../src/lib/suggest/scannables.js";
import type { CodexRow } from "../../../../src/lib/codexScans.js";
import type { RawInventoryData } from "../../../../src/types/inventory.js";

function row(type: string, name: string, scanned: number, required: number | null): CodexRow {
  return {
    type,
    name,
    scanned,
    required,
    complete: required === null ? null : scanned >= required,
    faction: "objects",
    image: null,
  };
}

const EXTRAS = {
  "/song/b": { section: "songs" },
  "/song/a": { section: "songs" },
  "/frag/earth": { section: "loreFragments", planet: "Earth", wiki: "https://wiki/Frag" },
  "/plant/x": { section: "plants" },
  "/obj/y": { section: "objects" },
  "/fighter/ash": { section: "fighterFrames" },
  "/enemy/z": {},
};

describe("missingScannables", () => {
  it("sorts each category by name and maps plants into objects", () => {
    const out = missingScannables(
      [
        row("/song/b", "Beta", 0, 4),
        row("/song/a", "Alpha", 1, 4),
        row("/obj/y", "Yarrow", 0, 1),
        row("/plant/x", "Xiphos", 0, null),
        row("/fighter/ash", "Ash", 0, 1),
        row("/enemy/z", "Zealot", 0, 3),
      ],
      EXTRAS,
    );
    expect(out.somachords.map((entry) => entry.name)).toEqual(["Alpha", "Beta"]);
    expect(out.objects.map((entry) => entry.name)).toEqual(["Xiphos", "Yarrow"]);
    expect(out.frameFighter.map((entry) => entry.name)).toEqual(["Ash"]);
    expect(out.fragments).toEqual([]);
  });

  it("drops complete entries, and unknown requirements once scanned", () => {
    const out = missingScannables(
      [
        row("/song/a", "Alpha", 4, 4),
        row("/plant/x", "Xiphos", 2, null),
        row("/obj/y", "Y", 3, null),
      ],
      EXTRAS,
    );
    expect(out.somachords).toEqual([]);
    expect(out.objects).toEqual([]);
  });

  it("carries location and wiki only where the data has them", () => {
    const out = missingScannables(
      [row("/frag/earth", "Earth", 1, 3), row("/song/a", "Alpha", 0, 4)],
      EXTRAS,
    );
    expect(out.fragments[0]).toMatchObject({ planet: "Earth", wiki: "https://wiki/Frag" });
    expect(out.somachords[0]).toMatchObject({ planet: null, wiki: null });
  });

  it("ignores rows the extras table does not know", () => {
    const out = missingScannables([row("/unknown", "Nope", 0, null)], EXTRAS);
    expect(Object.values(out).flat()).toEqual([]);
  });
});

describe("missingScannables with inventory lore scans", () => {
  const lore = (type: string, progress: number, region: string | null = null): LoreScan => ({
    type,
    progress,
    region,
  });
  const scannedOf = (out: MissingScannables, category: ScannableCategory, type: string) =>
    out[category].find((entry) => entry.type === type)?.scanned;

  it("counts inventory progress the profile never recorded", () => {
    const out = missingScannables(
      [row("/song/a", "Alpha", 0, 4), row("/fighter/ash", "Ash", 0, 1)],
      EXTRAS,
      [lore("/song/a", 2), lore("/fighter/ash", 1)],
    );
    expect(scannedOf(out, "somachords", "/song/a")).toBe(2);
    expect(out.frameFighter).toEqual([]);
  });

  it("keeps profile progress when the inventory has no row", () => {
    const out = missingScannables([row("/frag/earth", "Earth", 2, 3)], EXTRAS, []);
    expect(scannedOf(out, "fragments", "/frag/earth")).toBe(2);
  });

  it("takes the larger count when both sources have one", () => {
    const rows = [row("/song/a", "Alpha", 3, 5), row("/song/b", "Beta", 1, 5)];
    const out = missingScannables(rows, EXTRAS, [lore("/song/a", 1), lore("/SONG/B", 4)]);
    expect(scannedOf(out, "somachords", "/song/a")).toBe(3);
    expect(scannedOf(out, "somachords", "/song/b")).toBe(4);
  });

  it("ignores inventory rows no codex row names, and objects", () => {
    const out = missingScannables([row("/obj/y", "Yarrow", 0, 1)], EXTRAS, [
      lore("/obj/y", 1),
      lore("/nowhere", 9),
    ]);
    expect(out.objects.map((entry) => entry.scanned)).toEqual([0]);
    expect(Object.values(out).flat()).toHaveLength(1);
  });

  it("uses a plain planet region only where the wiki names no planet", () => {
    const planets = new Set(["Earth", "Venus"]);
    const out = missingScannables(
      [row("/song/a", "Alpha", 0, 4), row("/song/b", "Beta", 0, 4), row("/frag/earth", "E", 0, 3)],
      EXTRAS,
      [
        lore("/song/a", 1, "/Lotus/Language/Locations/Venus"),
        lore("/song/b", 1, "/Lotus/Language/Locations/Moon"),
        lore("/frag/earth", 1, "/Lotus/Language/Locations/Venus"),
      ],
      planets,
    );
    expect(out.somachords.map((entry) => entry.planet)).toEqual(["Venus", null]);
    expect(out.fragments[0]?.planet).toBe("Earth");
  });
});

describe("loreFragmentScans", () => {
  it("reads well-formed rows and skips the rest", () => {
    const inventory = {
      LoreFragmentScans: [
        { ItemType: "/song/a", Progress: 2, Region: "" },
        { ItemType: "/song/b", Progress: 1, Region: "/Lotus/Language/Locations/Earth" },
        { ItemType: 5, Progress: 1 },
        null,
      ],
    } as unknown as RawInventoryData;
    expect(loreFragmentScans(inventory)).toEqual([
      { type: "/song/a", progress: 2, region: null },
      { type: "/song/b", progress: 1, region: "/Lotus/Language/Locations/Earth" },
    ]);
    expect(loreFragmentScans(null)).toEqual([]);
  });
});

describe("scannableSuggestions", () => {
  it("keeps the given order", () => {
    const { somachords } = missingScannables(
      [row("/song/b", "Beta", 0, 4), row("/song/a", "Alpha", 0, 4)],
      EXTRAS,
    );
    const suggestions = scannableSuggestions(somachords);
    expect(suggestions.map((s) => [s.title, s.order])).toEqual([
      ["Alpha", 0],
      ["Beta", 1],
    ]);
    expect(suggestions[0]?.details?.scannable?.type).toBe("/song/a");
  });
});
