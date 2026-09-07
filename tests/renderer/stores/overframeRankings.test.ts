import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("../../../src/lib/ipc.js", () => ({ invoke: h.invoke }));

async function importStore() {
  vi.resetModules();
  return import("../../../src/stores/overframeRankings.js");
}

const BUNDLED = { tag: "bundled" };
const FRESH = { fetchedAt: "2026-09-01T00:00:00.000Z", categories: {}, items: {} };

beforeEach(() => {
  h.invoke.mockReset();
});

describe("overframe rankings store", () => {
  it("builds from the bundled table until a refreshed one arrives", async () => {
    let pending: (value: unknown) => void = () => {};
    h.invoke.mockReturnValueOnce(new Promise((resolve) => (pending = resolve)));
    const store = await importStore();
    const build = vi.fn((source: unknown) => () => (source === FRESH ? "S" : "D"));

    const tiers = store.preferFreshRankings(build, BUNDLED);
    expect(tiers("Saryn")).toBe("D");

    pending(FRESH);
    await store.loadOverframeRankings();

    expect(tiers("Saryn")).toBe("S");
    expect(get(store.overframeRankingsRevision)).toBe(1);
  });

  it("builds once per source", async () => {
    h.invoke.mockResolvedValueOnce(null);
    const store = await importStore();
    const build = vi.fn(() => () => "C");

    const tiers = store.preferFreshRankings(build, BUNDLED);
    tiers("Saryn");
    tiers("Ash");

    expect(build).toHaveBeenCalledTimes(1);
  });

  it("stays on the bundled table when the refresh request fails", async () => {
    h.invoke.mockRejectedValueOnce(new Error("no bridge"));
    const store = await importStore();
    const build = vi.fn((source: unknown) => () => (source === BUNDLED ? "B" : "S"));

    const tiers = store.preferFreshRankings(build, BUNDLED);
    await store.loadOverframeRankings();

    expect(tiers("Saryn")).toBe("B");
    expect(get(store.overframeRankingsRevision)).toBe(0);
  });
});
