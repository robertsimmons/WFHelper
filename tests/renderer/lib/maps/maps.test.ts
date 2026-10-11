import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MAP_IMAGE_URLS } from "../../../../src/lib/assetUrls.js";
import { mapNeeds } from "../../../../src/lib/maps/needs.js";
import {
  MAX_PIN_FILLS,
  fanOffsets,
  mapPins,
  orderedKinds,
  pinFills,
  pinKinds,
  pinsForNeeds,
  type MapPin,
  type PlacedPin,
} from "../../../../src/lib/maps/pins.js";
import { baseMap, baseMapKey, toScreen } from "../../../../src/lib/maps/registry.js";
import {
  resourceEntry,
  resourceLookup,
} from "../../../../src/lib/suggest/acquisition/plan/resources.js";
import type {
  ResolvedGroup,
  ResolvedPlan,
  ResolvedRow,
} from "../../../../src/lib/suggest/acquisition/plan/index.js";

const RESOURCES = resourceLookup({
  Kovnik: {
    kind: "farm",
    harvestable: true,
    map: "duviri",
    best: { place: "DUVIRI", sub: "Lunaro Court", activity: "Harvest Kovnik", meta: "all moods" },
  },
  Ueymag: {
    kind: "farm",
    harvestable: true,
    map: "kullervos-hold",
    best: { place: "KULLERVO'S HOLD, DUVIRI", sub: null, activity: "Harvest cactus", meta: null },
  },
  Aggristone: {
    kind: "farm",
    harvestable: true,
    map: "duviri",
    best: { place: "DUVIRI", sub: "Open landscape", activity: "Destroy formations", meta: null },
  },
  "Kovnik Pod": { alias: "Kovnik" },
});

function row(label: string, remaining: number | null, done = false): ResolvedRow {
  return {
    id: label,
    label,
    note: null,
    qty:
      remaining === null
        ? null
        : {
            required: remaining,
            owned: 0,
            remaining,
            text: remaining.toLocaleString("en-US"),
            requiredText: remaining.toLocaleString("en-US"),
            tracked: true,
          },
    alt: null,
    done,
    source: "inventory",
    manual: false,
  };
}

function group(map: string | null, rows: ResolvedRow[], skipped = false): ResolvedGroup {
  return {
    id: `${map}-${rows.length}`,
    type: "farm",
    place: "DUVIRI",
    sub: null,
    activity: null,
    meta: null,
    mode: null,
    live: null,
    skip: skipped ? { reason: "done" } : null,
    earns: null,
    spends: [],
    map,
    mapReady: baseMapKey(map) !== null,
    rows,
    conditions: [],
    bonuses: [],
    disclosures: [],
    tips: [],
    facts: [],
    done: rows.every((entry) => entry.done),
    remaining: rows.filter((entry) => !entry.done).length,
  };
}

const plan = (groups: ResolvedGroup[]): Pick<ResolvedPlan, "groups"> => ({ groups });

function pin(id: string, kind: string, refs: string[]): MapPin {
  return { id, position: [0, 0], kind, label: id, refs, note: null };
}

describe("map registry", () => {
  it("flips the wiki's bottom-left grid onto the screen", () => {
    expect(toScreen([100, 300], 4000)).toEqual([100, 3700]);
    expect(toScreen([0, 0], 4000)).toEqual([0, 4000]);
  });

  it("opens Duviri for the places inside it, and nothing for an unshipped map", () => {
    expect(baseMapKey("duviri")).toBe("duviri");
    expect(baseMapKey("kullervos-hold")).toBe("duviri");
    expect(baseMapKey("archarbor")).toBe("duviri");
    expect(baseMapKey("hollvania")).toBeNull();
    expect(baseMapKey(null)).toBeNull();
    expect(baseMap("archarbor")?.size).toBe(4000);
  });
});

describe("map pins", () => {
  it("loads every pin file for a map, aliases included", () => {
    const duviri = mapPins("duviri");
    expect(mapPins("kullervos-hold")).toEqual(duviri);
    const ids = new Set(duviri.map((entry) => entry.id));
    expect(ids.has("duviri-blinkpad-01")).toBe(true);
    expect(ids.has("duviri-cave-01")).toBe(true);
    expect([...ids].some((id) => !id.startsWith("duviri-"))).toBe(true);
    expect(duviri.find((entry) => entry.id === "duviri-blinkpad-01")?.refs).toEqual([
      "Saggen Pearl",
    ]);
    expect(mapPins("hollvania")).toEqual([]);
  });

  it("keeps only pins serving a need, refs in need order, caves drawn first", () => {
    const pins = [
      pin("fish", "fishing", ["Nacreous Pebble", "Maw Fang", "Ariette Scale"]),
      pin("lore", "fragment", ["/Lotus/Types/Lore/Fragments/X"]),
      pin("cave", "cave", ["tasoma extract"]),
      pin("pearl", "resource", ["Saggen Pearl"]),
    ];
    const placed = pinsForNeeds(pins, ["Ariette Scale", "Tasoma Extract", "Maw Fang"]);
    expect(placed.map((entry) => entry.pin.id)).toEqual(["cave", "fish"]);
    expect(placed[0].refs).toEqual(["Tasoma Extract"]);
    expect(placed[1].refs).toEqual(["Ariette Scale", "Maw Fang"]);
    const kinds = pinKinds(placed);
    expect(kinds.get("Maw Fang")).toEqual(new Map([["fishing", 1]]));
    expect(kinds.has("Saggen Pearl")).toBe(false);
  });

  it("fans pins that share a spot out by a fixed screen offset, leaving lone pins put", () => {
    const at = (id: string, kind: string, x: number, y: number): PlacedPin => ({
      pin: { ...pin(id, kind, ["Kovnik"]), position: [x, y] },
      refs: ["Kovnik"],
    });
    const fans = fanOffsets([
      at("cave", "cave", 10, 20),
      at("cave-fishing", "fishing", 10, 20),
      at("lone", "resource", 10, 21),
      at("a", "resource", 5, 5),
      at("b", "resource", 5, 5),
      at("c", "resource", 5, 5),
    ]);
    expect(fans.has("lone")).toBe(false);
    const [cx, cy] = fans.get("cave") ?? [0, 0];
    const [fx, fy] = fans.get("cave-fishing") ?? [0, 0];
    expect(cx).toBeLessThan(0);
    expect(fx).toBeGreaterThan(0);
    expect(Math.hypot(fx - cx, fy - cy)).toBeGreaterThanOrEqual(16);
    const trio = ["a", "b", "c"].map((id) => fans.get(id) ?? [0, 0]);
    const radii = trio.map(([x, y]) => Math.hypot(x, y));
    expect(new Set(radii.map((r) => r.toFixed(3))).size).toBe(1);
    expect(radii[0]).toBeGreaterThan(7);
    expect(new Set(trio.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)).size).toBe(3);
  });

  it("names a need by mining, then fishing, then harvest, then cave", () => {
    const kinds = (...names: string[]) => new Map(names.map((name) => [name, 1]));
    expect(orderedKinds(kinds("cave", "fishing", "mining"))).toEqual(["mining", "fishing", "cave"]);
    expect(orderedKinds(kinds("cave", "resource", "fishing"))).toEqual([
      "fishing",
      "resource",
      "cave",
    ]);
    expect(orderedKinds(kinds("cave", "resource"))[0]).toBe("resource");
    expect(orderedKinds(kinds("cave"))[0]).toBe("cave");
  });

  it("draws a pinless need's name as text, so it cannot solo an empty map", () => {
    const modal = readFileSync(
      fileURLToPath(
        new URL("../../../../src/components/maps/FarmMapModal.svelte", import.meta.url),
      ),
      "utf8",
    );
    const solo = modal.indexOf("onclick={() => solo(need)}");
    const guard = modal.lastIndexOf("{#if count > 0}", solo);
    expect(guard).toBeGreaterThan(-1);
    expect(modal.slice(guard, solo)).not.toContain("{/if}");
  });
});

describe("map needs", () => {
  it("merges open rows across every group on the same base map", () => {
    const needs = mapNeeds(
      plan([
        group("duviri", [row("Kovnik", 40), row("Saggen Pearl", 100, true)]),
        group("kullervos-hold", [row("Kovnik Pod", 1200), row("Ueymag", 200)]),
        group("orb-vallis", [row("Gallos Rods", 20)]),
        group("duviri", [row("Aggristone", 150)], true),
        group(null, [row("Credits", 75000)]),
      ]),
      "archarbor",
      RESOURCES,
    );
    expect(needs.map((need) => [need.name, need.qty])).toEqual([
      ["Kovnik", 1240],
      ["Ueymag", 200],
    ]);
    expect(needs[0].where).toBe("Lunaro Court · Harvest Kovnik · all moods");
    expect(needs[1].where).toBe("KULLERVO'S HOLD, DUVIRI · Harvest cactus");
    expect(needs[0].color).toBe("#2dd4bf");
  });

  it("keeps a row with no figure, and only what the store says is gathered on this map", () => {
    const needs = mapNeeds(
      plan([
        group("duviri", [
          row("Aggristone", null),
          row("Aggristone", 5),
          row("Mystery Moss", 10),
          row("Solaris United Standing", 5000),
          row("Kullervo's Bane", 1),
          row("Tepa Nodule", 30),
        ]),
      ]),
      "duviri",
      resourceLookup({
        Aggristone: { kind: "farm", harvestable: true, map: "duviri", best: null },
        "Solaris United Standing": { kind: "standing", harvestable: false, map: "orb-vallis" },
        "Kullervo's Bane": { kind: "farm", harvestable: false, map: "kullervos-hold" },
        "Tepa Nodule": { kind: "farm", harvestable: true, map: "orb-vallis" },
      }),
    );
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ name: "Aggristone", qty: 5, where: null });
  });

  it("drops currencies, boss drops and rewards from the shipped plans' maps", () => {
    const needs = mapNeeds(
      plan([
        group("duviri", [
          row("Kullervo's Bane", 1),
          row("Solaris United Standing", 5000),
          row("Aggristone", 100),
        ]),
      ]),
      "duviri",
    );
    expect(needs.map((need) => need.name)).toEqual(["Aggristone"]);
  });

  it("answers nothing for a map that has not shipped", () => {
    expect(mapNeeds(plan([group("hollvania", [row("Gallos Rods", 20)])]), "hollvania")).toEqual([]);
  });

  it("gives every need in one plan its own colour, however many there are", () => {
    const ores = Array.from({ length: 48 }, (_, index) => `Ore ${index}`);
    const lookup = resourceLookup({
      Kovnik: { kind: "farm", harvestable: true, map: "duviri" },
      ...Object.fromEntries(
        ores.map((name) => [name, { kind: "farm", harvestable: true, map: "duviri" }]),
      ),
    });
    const needs = mapNeeds(
      plan([group("duviri", [row("Kovnik", 1), ...ores.map((name) => row(name, 1))])]),
      "duviri",
      lookup,
    );
    expect(needs).toHaveLength(49);
    const colors = needs.map((need) => need.color);
    expect(colors[0]).toBe("#2dd4bf");
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("pin fills", () => {
  const colors = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`R${index}`, `#00000${index.toString(16)}`]),
  );

  it("caps the slices and flags the refs it leaves out", () => {
    const refs = Object.keys(colors);
    const paint = pinFills({ pin: pin("cave", "cave", refs), refs }, colors);
    expect(paint.fills).toEqual(refs.slice(0, MAX_PIN_FILLS).map((ref) => colors[ref]));
    expect(paint.more).toBe(true);
    expect(pinFills({ pin: pin("one", "resource", ["R1"]), refs: ["R1"] }, colors)).toEqual({
      fills: ["#000001"],
      more: false,
    });
  });

  it("paints a pin by its kind when kind colours are given", () => {
    const refs = ["R1", "R2", "R3", "R4", "R5"];
    const kindColors = { fragment: "#123456" };
    expect(pinFills({ pin: pin("f", "fragment", refs), refs }, colors, kindColors)).toEqual({
      fills: ["#123456"],
      more: false,
    });
    expect(
      pinFills({ pin: pin("s", "somachord", ["R1"]), refs: ["R1"] }, colors, kindColors),
    ).toEqual({ fills: ["#000001"], more: false });
  });
});

const FARM_FILES = import.meta.glob("../../../../src/data/maps/pins/farm-*.json", {
  eager: true,
  import: "default",
});

const farmFiles = Object.entries(FARM_FILES).map(([path, raw]) => ({
  key: path.slice(path.lastIndexOf("/farm-") + 6).replace(/\.json$/, ""),
  raw,
}));

describe("shipped maps", () => {
  it("resolves every registered map", () => {
    for (const key of Object.keys(MAP_IMAGE_URLS)) {
      expect(baseMapKey(key)).toBe(key);
      expect(baseMap(key)).toMatchObject({
        key,
        size: 4000,
        imageUrl: MAP_IMAGE_URLS[key as keyof typeof MAP_IMAGE_URLS],
      });
    }
    expect(baseMap("cambion-drift")?.backdrop).toMatch(/^#[0-9a-f]{6}$/);
    expect(baseMap("orb-vallis")?.backdrop).toBeNull();
  });

  it("ships a farm pin file for every registered map", () => {
    expect(farmFiles.map((file) => file.key).sort()).toEqual(Object.keys(MAP_IMAGE_URLS).sort());
  });

  it.each(farmFiles)("farm-$key.json has a valid shape", ({ key, raw }) => {
    expect(baseMapKey(key)).not.toBeNull();
    expect(Array.isArray(raw)).toBe(true);
    const pins = raw as Record<string, unknown>[];
    const ids = pins.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of pins) {
      expect(typeof entry.id, String(entry.id)).toBe("string");
      expect(typeof entry.kind, String(entry.id)).toBe("string");
      const position = entry.position as unknown[];
      expect(position, String(entry.id)).toHaveLength(2);
      for (const axis of position) {
        expect(typeof axis).toBe("number");
        expect(axis as number).toBeGreaterThanOrEqual(0);
        expect(axis as number).toBeLessThanOrEqual(4000);
      }
      const refs = entry.refs as unknown[];
      expect(refs.length, String(entry.id)).toBeGreaterThan(0);
      for (const ref of refs) expect(typeof ref === "string" && ref.trim() !== "").toBe(true);
    }
    const loaded = new Set(mapPins(key).map((entry) => entry.id));
    expect(ids.filter((id) => !loaded.has(id as string))).toEqual([]);
  });

  it.each(farmFiles)("every ref in farm-$key.json is harvestable there", ({ key, raw }) => {
    const target = baseMapKey(key);
    const stray: string[] = [];
    for (const entry of raw as { id: string; refs: string[] }[]) {
      for (const ref of entry.refs) {
        const found = resourceEntry(ref);
        if (!found?.harvestable || baseMapKey(found.map) !== target) {
          stray.push(`${entry.id}: ${ref}`);
        }
      }
    }
    expect(stray).toEqual([]);
  });

  // The store's own mechanism text classifies refs, so a new fish part or ore is
  // covered the day it is added; a hand list here would drift from the store.
  it.each(farmFiles)("no fishing or cave pin in farm-$key.json mixes fish with ore", ({ raw }) => {
    const how = (ref: string): string => resourceEntry(ref)?.best?.how?.toLowerCase() ?? "";
    const mixed: string[] = [];
    for (const entry of raw as { id: string; kind: string; refs: string[] }[]) {
      const fish = entry.refs.filter((ref) => how(ref).startsWith("fishing"));
      const ore = entry.refs.filter((ref) => how(ref).startsWith("mining"));
      if (entry.kind === "fishing" && ore.length > 0) mixed.push(`${entry.id}: ${ore.join(", ")}`);
      if ((entry.kind === "cave" || entry.kind === "mining") && fish.length > 0) {
        mixed.push(`${entry.id}: ${fish.join(", ")}`);
      }
    }
    expect(mixed).toEqual([]);
  });
});
