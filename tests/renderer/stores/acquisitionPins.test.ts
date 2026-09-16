import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import {
  SOFT_ACQUISITION_PINS,
  acquisitionPins,
  toggleAcquisitionPin,
  unpinAcquisitionItems,
} from "../../../src/stores/acquisitionPins.js";

const PIN_KEY = "acquisition.pinnedItems";

/** A fresh copy of the store over a seeded localStorage, plus the keys it wrote. */
async function loadWithStorage(seed: Record<string, string> = {}) {
  const mem = new Map(Object.entries(seed));
  const writes: string[] = [];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      mem.set(key, value);
    },
  });
  vi.resetModules();
  return { store: await import("../../../src/stores/acquisitionPins.js"), mem, writes };
}

describe("acquisition pins", () => {
  beforeEach(() => acquisitionPins.set([]));

  it("adds and removes a pin with the same toggle", () => {
    toggleAcquisitionPin("/Lotus/Powersuits/Rhino");
    expect(get(acquisitionPins)).toEqual(["/Lotus/Powersuits/Rhino"]);
    toggleAcquisitionPin("/Lotus/Powersuits/Rhino");
    expect(get(acquisitionPins)).toEqual([]);
  });

  it("ignores an empty uniqueName", () => {
    toggleAcquisitionPin("");
    expect(get(acquisitionPins)).toEqual([]);
  });

  it("appends, so the strip reads oldest first", () => {
    toggleAcquisitionPin("/a");
    toggleAcquisitionPin("/b");
    expect(get(acquisitionPins)).toEqual(["/a", "/b"]);
  });

  it("drops duplicates a set or a corrupt list would introduce", () => {
    acquisitionPins.set(["/a", "/b", "/a"]);
    expect(get(acquisitionPins)).toEqual(["/a", "/b"]);
    acquisitionPins.update((list) => [...list, "/b"]);
    expect(get(acquisitionPins)).toEqual(["/a", "/b"]);
  });

  it("drops one pin without touching the rest", () => {
    acquisitionPins.set(["/a", "/b", "/c"]);
    unpinAcquisitionItems(["/b"]);
    expect(get(acquisitionPins)).toEqual(["/a", "/c"]);
  });

  it("leaves the list alone when nothing is dropped", () => {
    acquisitionPins.set(["/a"]);
    unpinAcquisitionItems([]);
    expect(get(acquisitionPins)).toEqual(["/a"]);
  });

  it("keeps a pin past the soft cap rather than refusing or evicting one", () => {
    const over = Array.from({ length: SOFT_ACQUISITION_PINS + 1 }, (_, index) => `/p${index}`);
    for (const uniqueName of over) toggleAcquisitionPin(uniqueName);
    expect(get(acquisitionPins)).toEqual(over);
  });
});

describe("acquisition pins and storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips a pin through localStorage", async () => {
    const { store, mem, writes } = await loadWithStorage();

    expect(writes).toEqual([]);
    store.toggleAcquisitionPin("/a");
    expect(mem.get(PIN_KEY)).toBe(JSON.stringify(["/a"]));

    const reopened = await loadWithStorage({ [PIN_KEY]: mem.get(PIN_KEY) ?? "" });
    expect(get(reopened.store.acquisitionPins)).toEqual(["/a"]);
  });

  it("dedupes a hand-edited list without rewriting it", async () => {
    const raw = JSON.stringify(["/a", "/b", "/a"]);
    const { store, mem, writes } = await loadWithStorage({ [PIN_KEY]: raw });

    expect(get(store.acquisitionPins)).toEqual(["/a", "/b"]);
    expect(writes).toEqual([]);
    expect(mem.get(PIN_KEY)).toBe(raw);
  });
});
