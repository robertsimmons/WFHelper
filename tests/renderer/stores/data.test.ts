import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FoundryData, ItemDbEntry, RawInventoryData } from "../../../src/types/inventory.js";

const parseFoundryMock = vi.hoisted(() => vi.fn<() => FoundryData>());
const parseInventoryMock = vi.hoisted(() => vi.fn(() => []));

vi.mock("../../../src/lib/inventory.js", () => ({
  parseInventory: parseInventoryMock,
}));

vi.mock("../../../src/lib/inventory/foundryResources.js", () => ({
  parseFoundry: parseFoundryMock,
}));

describe("foundryData", () => {
  beforeEach(() => {
    vi.resetModules();
    parseFoundryMock.mockReset();
    parseInventoryMock.mockClear();
  });

  it("does not parse Foundry data until a consumer subscribes", async () => {
    const foundryResult: FoundryData = { building: [], recipes: [] };
    parseFoundryMock.mockReturnValue(foundryResult);

    const stores = await import("../../../src/stores/data.js");
    const inventory: RawInventoryData = {
      Recipes: [{ ItemType: "/Lotus/Recipes/TestBlueprint", ItemCount: 1 }],
    };
    const db: Record<string, ItemDbEntry> = {
      "/Lotus/Recipes/TestBlueprint": { name: "Test Blueprint" },
    };

    stores.inventoryData.set(inventory);
    stores.itemDb.set(db);

    expect(parseFoundryMock).not.toHaveBeenCalled();

    const unsubscribe = stores.foundryData.subscribe(() => {});

    expect(parseFoundryMock).toHaveBeenCalledTimes(1);
    expect(get(stores.foundryData)).toBe(foundryResult);

    unsubscribe();

    const unsubscribeAgain = stores.foundryData.subscribe(() => {});

    expect(parseFoundryMock).toHaveBeenCalledTimes(1);

    unsubscribeAgain();
  });
});

describe("hideFoundryClaims", () => {
  const BLUEPRINT = "/Lotus/Types/Recipes/WarframeRecipes/HildrynPrimeBlueprint";

  beforeEach(() => {
    vi.resetModules();
    parseInventoryMock.mockClear();
  });

  async function parsedRecipes(hide: boolean, reusable = false): Promise<unknown> {
    const stores = await import("../../../src/stores/data.js");
    const prefs = await import("../../../src/stores/preferences.js");
    prefs.hideFoundryClaims.set(hide);
    stores.inventoryData.set({
      Recipes: [{ ItemType: BLUEPRINT, ItemCount: 1 }],
      PendingRecipes: [{ ItemType: BLUEPRINT }],
    });
    stores.itemDb.set({
      [BLUEPRINT]: {
        name: "Hildryn Prime Blueprint",
        ...(reusable ? { reusableBlueprint: true } : {}),
      },
    });

    const unsubscribe = stores.parsedItems.subscribe(() => {});
    unsubscribe();
    const calls = parseInventoryMock.mock.calls as unknown[][];
    return calls[calls.length - 1][0];
  }

  it("strips the foundry copy before parsing when enabled", async () => {
    expect((await parsedRecipes(true)) as { Recipes: unknown[] }).toMatchObject({ Recipes: [] });
  });

  it("leaves the raw counts alone when disabled", async () => {
    expect((await parsedRecipes(false)) as { Recipes: unknown[] }).toMatchObject({
      Recipes: [{ ItemType: BLUEPRINT, ItemCount: 1 }],
    });
  });

  it("keeps a reusable blueprint the item db flags, even while it builds", async () => {
    expect((await parsedRecipes(true, true)) as { Recipes: unknown[] }).toMatchObject({
      Recipes: [{ ItemType: BLUEPRINT, ItemCount: 1 }],
    });
  });
});

describe("foundryPending", () => {
  const BLUEPRINT = "/Lotus/Types/Recipes/WarframeRecipes/HildrynPrimeBlueprint";
  const BUILT = "/Lotus/Powersuits/Hildryn/HildrynPrime";

  beforeEach(() => {
    vi.resetModules();
  });

  async function pending(hide: boolean): Promise<Map<string, number>> {
    const stores = await import("../../../src/stores/data.js");
    const prefs = await import("../../../src/stores/preferences.js");
    prefs.hideFoundryClaims.set(hide);
    stores.inventoryData.set({ PendingRecipes: [{ ItemType: BLUEPRINT }] });
    stores.itemDb.set({
      [BLUEPRINT]: { name: "Hildryn Prime Blueprint", buildsProduct: BUILT },
    });

    return get(stores.foundryPending);
  }

  it("counts the build under both the blueprint and the frame", async () => {
    const counts = await pending(true);

    expect(counts.get(BLUEPRINT)).toBe(1);
    expect(counts.get(BUILT)).toBe(1);
  });

  it("stays empty while the ownership count still holds the foundry copy", async () => {
    expect((await pending(false)).size).toBe(0);
  });
});
