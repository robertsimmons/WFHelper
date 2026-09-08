import { describe, expect, it } from "vitest";

import {
  advances,
  gainOf,
  leastGain,
  masteryGain,
  needsGain,
  ownedGain,
} from "../../../../src/lib/suggest/gain.js";

describe("gainOf", () => {
  it("reads an absent signal as a full gain", () => {
    expect(gainOf({ value: 1, effort: 0, urgency: 0 })).toBe(1);
  });

  it("clamps whatever a provider supplied", () => {
    expect(gainOf({ value: 1, effort: 0, urgency: 0, gain: 4 })).toBe(1);
    expect(gainOf({ value: 1, effort: 0, urgency: 0, gain: -1 })).toBe(0);
  });
});

describe("advances", () => {
  it("is false only at zero", () => {
    expect(advances(0)).toBe(false);
    expect(advances(0.01)).toBe(true);
  });
});

describe("leastGain", () => {
  it("takes the least advancing read, since one exhausted reason is enough", () => {
    expect(leastGain(1, 0.5, 0.8)).toBe(0.5);
    expect(leastGain(0.5, undefined)).toBe(0.5);
    expect(leastGain()).toBe(1);
    expect(leastGain(1, 0)).toBe(0);
  });
});

describe("masteryGain", () => {
  it("drops a mastered item and keeps a part-ranked one", () => {
    expect(masteryGain("mastered")).toBe(0);
    expect(masteryGain("progress")).toBe(0.5);
    expect(masteryGain("missing")).toBe(1);
  });

  it("reads an unknown status as unread, never as already done", () => {
    expect(masteryGain(undefined)).toBe(1);
  });
});

describe("ownedGain", () => {
  it("drops a component, blueprint or frame already in hand", () => {
    expect(ownedGain({ owned: 2 })).toBe(0);
    expect(ownedGain({ owned: 0, built: 1 })).toBe(0);
    expect(ownedGain({ owned: 0, pending: 1 })).toBe(0);
    expect(ownedGain({ owned: 0 })).toBe(1);
  });

  it("keeps the gain on anything that stacks", () => {
    expect(ownedGain({ owned: 12 }, true)).toBe(1);
  });

  it("reads an unread inventory as unknown, not as owning nothing", () => {
    expect(ownedGain(null)).toBe(1);
  });
});

describe("needsGain", () => {
  it("puts unmastered gear above a frame that only owes its subsume", () => {
    expect(needsGain(["mastery"])).toBe(1);
    expect(needsGain(["subsume"])).toBeLessThan(needsGain(["mastery"]));
    expect(needsGain(["mastery", "subsume"])).toBe(1);
  });

  it("finds nothing to build in an adapter or a Prime upgrade alone", () => {
    expect(needsGain(["incarnon"])).toBe(0);
    expect(needsGain(["prime"])).toBe(0);
    expect(needsGain([])).toBe(0);
  });
});
