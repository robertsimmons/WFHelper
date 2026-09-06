import { describe, expect, it } from "vitest";

import { affinityBoost, liveBoost } from "../../../../src/lib/suggest/boosts.js";
import type { GlobalBoost, WorldState } from "../../../../src/types/world.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const HOUR = 60 * 60_000;

function boost(overrides: Partial<GlobalBoost> = {}): GlobalBoost {
  return {
    kind: "affinity",
    multiplier: 2,
    activation: new Date(NOW - HOUR).toISOString(),
    expiry: new Date(NOW + HOUR).toISOString(),
    ...overrides,
  };
}

function world(boosts: GlobalBoost[]): WorldState {
  return { globalBoosts: boosts } as WorldState;
}

describe("affinityBoost", () => {
  it("finds nothing when the world state carries no boosts", () => {
    expect(affinityBoost(null, NOW)).toBeNull();
    expect(affinityBoost({} as WorldState, NOW)).toBeNull();
  });

  it("reports the multiplier while the window is open", () => {
    expect(affinityBoost(world([boost({ multiplier: 3 })]), NOW)).toBe(3);
  });

  it("ignores a boost whose window has closed", () => {
    const past = boost({
      activation: new Date(NOW - 3 * HOUR).toISOString(),
      expiry: new Date(NOW - HOUR).toISOString(),
    });
    expect(affinityBoost(world([past]), NOW)).toBeNull();
  });

  it("ignores a boost that has not started yet", () => {
    const upcoming = boost({
      activation: new Date(NOW + HOUR).toISOString(),
      expiry: new Date(NOW + 3 * HOUR).toISOString(),
    });
    expect(affinityBoost(world([upcoming]), NOW)).toBeNull();
  });

  it("ignores a live boost of another kind", () => {
    expect(affinityBoost(world([boost({ kind: "resources" })]), NOW)).toBeNull();
    expect(liveBoost(world([boost({ kind: "resources" })]), "resources", NOW)?.multiplier).toBe(2);
  });
});
