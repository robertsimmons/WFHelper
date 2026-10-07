import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchBackendRaw: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("../../../src/lib/ipc.js", () => ({ invoke: mocks.invoke }));
vi.mock("../../../src/lib/wfm/backendLite.js", () => ({
  fetchBackendRaw: mocks.fetchBackendRaw,
  isBackendLiteConfigured: () => true,
}));
vi.mock("../../../src/lib/log.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { __test__ as snapshotTest, tryLoadSnapshot } from "../../../src/lib/wfm/snapshotLoader.js";
import { __test__ as priceCacheTest, getCachedPriceState } from "../../../src/lib/wfm/priceCache.js";
import {
  importSetCatalogFromSnapshotMeta,
  resolveSnapshotSetSlug,
} from "../../../src/lib/wfm/wfmItemMeta.js";

function completeSetMeta(now: number) {
  return Object.fromEntries(
    Array.from({ length: 200 }, (_, index) => {
      const slug = `cached_${index}_set`;
      return [
        slug,
        {
          slug,
          ducats: null,
          setRoot: true,
          thumb: null,
          icon: null,
          timestamp: now - 24 * 60 * 60 * 1000,
        },
      ];
    }),
  );
}

afterEach(() => {
  mocks.fetchBackendRaw.mockReset();
  mocks.invoke.mockReset();
  importSetCatalogFromSnapshotMeta({});
  priceCacheTest.clearPriceCache();
  snapshotTest.reset();
});

function snapshotResponse(status: number, body: unknown, etag: string | null) {
  return {
    status,
    json: async () => body,
    headers: { get: (name: string) => (name === "etag" ? etag : null) },
  };
}

function ifNoneMatch(call: number): string | undefined {
  return mocks.fetchBackendRaw.mock.calls[call][1].headers["If-None-Match"];
}

describe("snapshot 304 refresh", () => {
  it("re-imports the held snapshot when the backend answers 304", async () => {
    const now = Date.now();
    mocks.invoke.mockResolvedValue(null);
    mocks.fetchBackendRaw.mockResolvedValueOnce(
      snapshotResponse(
        200,
        {
          version: 1,
          generatedAt: now,
          prices: { boltor_prime_set: { status: "ok", median: 42, timestamp: now } },
          meta: {},
          orderSummaries: {},
        },
        '"v1"',
      ),
    );
    await tryLoadSnapshot();
    expect(getCachedPriceState("boltor_prime_set")?.median).toBe(42);

    // Stands in for the price cache evicting aged entries between refreshes.
    priceCacheTest.clearPriceCache();
    mocks.fetchBackendRaw.mockResolvedValueOnce(snapshotResponse(304, null, null));
    await tryLoadSnapshot();

    expect(ifNoneMatch(1)).toBe('"v1"');
    expect(getCachedPriceState("boltor_prime_set")?.median).toBe(42);
  });
});

describe("snapshot set-catalog fallback", () => {
  it("restores a stale last-good catalog when the backend is unavailable", async () => {
    const now = Date.now();
    const meta = completeSetMeta(now);
    const firstSlug = Object.keys(meta)[0];
    mocks.invoke.mockResolvedValue({
      version: 1,
      generatedAt: now - 3 * 60 * 60 * 1000,
      prices: {},
      meta,
      orderSummaries: {},
    });
    mocks.fetchBackendRaw.mockResolvedValue(null);

    await tryLoadSnapshot();

    expect(resolveSnapshotSetSlug([firstSlug])).toBe(firstSlug);
    expect(resolveSnapshotSetSlug(["seer_set"])).toBeNull();
  });
});
