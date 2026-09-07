import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir = "";
// Non-null swaps the bundled rankings table for this text.
let shippedOverride: string | null = null;

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name !== "userData") throw new Error(`unexpected getPath(${name})`);
      return tmpDir;
    },
  },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((file: unknown, ...rest: unknown[]) => {
    if (shippedOverride !== null && String(file).endsWith("rankings.json")) return shippedOverride;
    return (actual.readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof actual.readFileSync;
  const patched = { ...actual, readFileSync };
  return { ...patched, default: patched };
});

import {
  getRefreshedRankings,
  loadFromDisk,
  refreshIfStale,
  resetForTest,
} from "../../services/overframeRankings";

const CACHE = "overframe-rankings-cache.json";

const INDEX = { results: [{ id: 0, title: "Warframes" }] };
const VOTES = { votes: [{ item_id: 42, average_score: 1.5, total: 900 }] };

function shipped(fetchedAt: string): string {
  return JSON.stringify({
    fetchedAt,
    categories: { "0": "Warframes" },
    items: {
      saryn: {
        id: 42,
        name: "Saryn",
        slug: "saryn",
        category: "Warframes",
        categoryId: 0,
        averageScore: 3,
        votes: 10,
      },
    },
  });
}

function cached(fetchedAt: string): void {
  fs.writeFileSync(path.join(tmpDir, CACHE), shipped(fetchedAt));
}

function readCache(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, CACHE), "utf-8")) as Record<string, unknown>;
}

function respond(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
}

function mockFetch(): ReturnType<typeof vi.fn> {
  const impl = vi.fn(async (url: string) =>
    url.endsWith("/tierlists/") ? respond(INDEX) : respond(VOTES),
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-overframe-"));
  shippedOverride = shipped("2020-01-01T00:00:00.000Z");
  resetForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("overframe ranking refresh", () => {
  it("writes a fetched table to the user data directory", async () => {
    const fetchImpl = mockFetch();

    expect(await refreshIfStale()).toEqual({ refreshed: true });

    // The tier list index plus one list per category.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const written = readCache();
    expect(written.items).toMatchObject({ saryn: { id: 42, averageScore: 1.5, votes: 900 } });
    expect(written.categories).toEqual({ "0": "Warframes" });
  });

  it("skips the network while the last fetch is inside the week", async () => {
    cached(new Date(Date.now() - 60_000).toISOString());
    const fetchImpl = mockFetch();

    expect(await refreshIfStale()).toEqual({ refreshed: false });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips the network while the shipped table is inside the week", async () => {
    shippedOverride = shipped(new Date(Date.now() - 60_000).toISOString());
    const fetchImpl = mockFetch();

    expect(await refreshIfStale()).toEqual({ refreshed: false });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, CACHE))).toBe(false);
  });

  it("leaves the previous table in place when the fetch fails", async () => {
    cached("2021-01-01T00:00:00.000Z");
    loadFromDisk();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    );

    expect(await refreshIfStale()).toEqual({ refreshed: false });

    expect(readCache()).toMatchObject({ fetchedAt: "2021-01-01T00:00:00.000Z" });
    expect(await getRefreshedRankings()).toMatchObject({ fetchedAt: "2021-01-01T00:00:00.000Z" });
  });

  it("rejects a malformed payload rather than writing it", async () => {
    cached("2021-01-01T00:00:00.000Z");
    loadFromDisk();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/tierlists/") ? respond(INDEX) : respond({ votes: "not an array" }),
      ),
    );

    expect(await refreshIfStale()).toEqual({ refreshed: false });

    expect(readCache()).toMatchObject({ fetchedAt: "2021-01-01T00:00:00.000Z" });
  });

  it("keeps a corrupt cache from replacing the shipped table", async () => {
    fs.writeFileSync(path.join(tmpDir, CACHE), "{ not json");

    expect(loadFromDisk()).toBeNull();
  });
});
