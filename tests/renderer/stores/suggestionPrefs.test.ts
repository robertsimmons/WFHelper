import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import { normalizeName } from "../../../src/lib/suggest/rewards.js";
import { bandCeiling, groupForWorth } from "../../../src/lib/suggest/worthLadder.js";
import { DEFAULT_NIGHTWAVE_STOCK, NIGHTWAVE_STAPLES } from "../../../src/types/suggest.js";

const REWARD_KEY = "next-up-reward-tiers";
const ORDER_KEY = "next-up-reward-order";
const STOCK_KEY = "next-up-nightwave-stock";

/** A fresh copy of the store over a seeded localStorage. */
async function loadWithStorage(seed: Record<string, string> = {}) {
  const mem = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => mem.set(key, value),
    removeItem: (key: string) => mem.delete(key),
  });
  vi.resetModules();
  const store = await import("../../../src/stores/suggestionPrefs.js");
  const ladder = await import("../../../src/lib/suggest/worthLadder.js");
  return { store, ladder, mem };
}

function stored(mem: Map<string, string>, key: string): Record<string, unknown> {
  return JSON.parse(mem.get(key) ?? "{}") as Record<string, unknown>;
}

describe("the suggestion preference store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("publishes a stored order to the ladder before anything scores", async () => {
    const { ladder } = await loadWithStorage({
      [ORDER_KEY]: JSON.stringify({ "Umbra Forma": 1, credits: 0 }),
    });
    expect(ladder.ladderPositionsForTest()).toEqual({ "umbra forma": 1, credits: 0 });
    expect(ladder.ladderWorth("junk", "credits")).toBe(ladder.bandCeiling("junk"));
  });

  it("spells out the whole group a drag reordered, and persists it", async () => {
    const { store, ladder, mem } = await loadWithStorage();
    const worth = get(store.suggestionPreferences).worth;
    const want = Object.keys(worth).filter((key) => worth[key] === "want");
    const ordered = ladder.orderEntries("want", want);
    const moved = ordered[ordered.length - 1] ?? "";

    store.moveRewardEntry("want", ordered, moved, 0);

    expect(ladder.orderEntries("want", want)).toEqual([moved, ...ordered.slice(0, -1)]);
    expect(ladder.ladderWorth("want", moved)).toBe(bandCeiling("want"));
    expect(Object.keys(stored(mem, ORDER_KEY)).sort()).toEqual([...ordered].sort());
    expect(get(store.suggestionOverrides).rewardOrder[moved]).toBe(0);
  });

  it("does not claim an override for a drag inside the group the entry ships in", async () => {
    const { store, ladder, mem } = await loadWithStorage();
    const worth = get(store.suggestionPreferences).worth;
    const ordered = ladder.orderEntries(
      "useful",
      Object.keys(worth).filter((key) => worth[key] === "useful"),
    );

    store.moveRewardEntry("useful", ordered, ordered[2] ?? "", 0);

    expect(stored(mem, REWARD_KEY)).toEqual({});
  });

  it("carries an entry across groups without leaving it in the old band", async () => {
    const { store, ladder } = await loadWithStorage();
    const key = normalizeName("Credits");
    const worth = get(store.suggestionPreferences).worth;
    const must = ladder.orderEntries(
      "must",
      Object.keys(worth).filter((entry) => worth[entry] === "must"),
    );

    store.moveRewardEntry("must", [...must, key], key, 0);

    expect(get(store.suggestionPreferences).worth[key]).toBe("must");
    expect(groupForWorth(ladder.ladderWorth("must", key))).toBe("must");
    expect(ladder.ladderWorth("must", key)).toBe(bandCeiling("must"));
  });

  it("drops a chosen position when the group is picked rather than dragged", async () => {
    const { store, ladder } = await loadWithStorage();
    const key = normalizeName("Credits");
    store.moveRewardEntry("must", [key], key, 0);
    expect(ladder.ladderPositionsForTest()[key]).toBe(0);

    store.setRewardWorth(key, "filler");

    expect(ladder.ladderPositionsForTest()[key]).toBeUndefined();
    expect(groupForWorth(ladder.ladderWorth("filler", key))).toBe("filler");
  });

  it("keeps a store written before the ladder had an order", async () => {
    const { store } = await loadWithStorage({
      [REWARD_KEY]: JSON.stringify({ kuva: "great" }),
    });
    const prefs = get(store.suggestionPreferences);
    expect(prefs.worth["kuva"]).toBe("must");
    expect(prefs.worth["umbra forma"]).toBe("must");
    expect(get(store.suggestionOverrides).rewardOrder).toEqual({});
  });

  it("clears every chosen position on a reset", async () => {
    const { store, ladder, mem } = await loadWithStorage();
    store.moveRewardEntry("junk", ["credits"], "credits", 0);
    expect(ladder.ladderPositionsForTest()["credits"]).toBe(0);

    store.resetSuggestionPreferences();

    expect(ladder.ladderPositionsForTest()).toEqual({});
    expect(stored(mem, ORDER_KEY)).toEqual({});
  });
});

describe("the nightwave keep-on-hand levels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("starts every staple on the level it ships at", async () => {
    const { store } = await loadWithStorage();
    const stock = get(store.suggestionPreferences).nightwaveStock;
    for (const name of NIGHTWAVE_STAPLES) expect(stock[name]).toBe(DEFAULT_NIGHTWAVE_STOCK);
    expect(get(store.suggestionOverrides).nightwaveStock).toEqual({});
  });

  it("reads a stored level and leaves the other staples alone", async () => {
    const { store } = await loadWithStorage({
      [STOCK_KEY]: JSON.stringify({ "Nitain Extract": 0, "orokin catalyst": 12 }),
    });
    const stock = get(store.suggestionPreferences).nightwaveStock;
    expect(stock["nitain extract"]).toBe(0);
    expect(stock["orokin catalyst"]).toBe(12);
    expect(stock["orokin reactor"]).toBe(DEFAULT_NIGHTWAVE_STOCK);
  });

  it("keeps a store written before the levels existed, on the defaults", async () => {
    // Everything a pre-nightwave store held, and no level key at all.
    const { store, mem } = await loadWithStorage({
      [REWARD_KEY]: JSON.stringify({ kuva: "great" }),
    });
    expect(mem.get(STOCK_KEY)).toBeUndefined();

    const prefs = get(store.suggestionPreferences);
    expect(prefs.worth["kuva"]).toBe("must");
    for (const name of NIGHTWAVE_STAPLES) {
      expect(prefs.nightwaveStock[name]).toBe(DEFAULT_NIGHTWAVE_STOCK);
    }

    store.setNightwaveStock("Nitain Extract", 2);

    expect(get(store.suggestionPreferences).worth["kuva"]).toBe("must");
    expect(stored(mem, REWARD_KEY)).toEqual({ kuva: "must" });
    expect(stored(mem, STOCK_KEY)).toEqual({ "nitain extract": 2 });
  });

  it("stores a level as a count of items and normalizes the name", async () => {
    const { store, mem } = await loadWithStorage();

    store.setNightwaveStock("Orokin Reactor", 3.6);
    store.setNightwaveStock("orokin catalyst", -4);

    expect(stored(mem, STOCK_KEY)).toEqual({ "orokin reactor": 4, "orokin catalyst": 0 });
    expect(get(store.suggestionPreferences).nightwaveStock["orokin reactor"]).toBe(4);
  });

  it("reverts a staple to the shipped level on a null or an unusable value", async () => {
    const { store, mem } = await loadWithStorage({
      [STOCK_KEY]: JSON.stringify({ "orokin reactor": 1, "nitain extract": 1 }),
    });

    store.setNightwaveStock("orokin reactor", null);
    store.setNightwaveStock("nitain extract", Number.NaN);

    expect(stored(mem, STOCK_KEY)).toEqual({});
    const stock = get(store.suggestionPreferences).nightwaveStock;
    expect(stock["orokin reactor"]).toBe(DEFAULT_NIGHTWAVE_STOCK);
    expect(stock["nitain extract"]).toBe(DEFAULT_NIGHTWAVE_STOCK);
  });

  it("clears every chosen level on a reset", async () => {
    const { store, mem } = await loadWithStorage();
    store.setNightwaveStock("orokin catalyst", 0);
    expect(stored(mem, STOCK_KEY)).toEqual({ "orokin catalyst": 0 });

    store.resetSuggestionPreferences();

    expect(stored(mem, STOCK_KEY)).toEqual({});
    expect(get(store.suggestionPreferences).nightwaveStock["orokin catalyst"]).toBe(
      DEFAULT_NIGHTWAVE_STOCK,
    );
  });
});
