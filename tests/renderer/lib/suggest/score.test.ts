import { describe, expect, it } from "vitest";

import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { rewardValue } from "../../../../src/lib/suggest/rewards.js";
import {
  DEFAULT_WEIGHTS,
  bandFor,
  clamp01,
  effectiveWorth,
  orderingScore,
  timeLeftMs,
  urgencyFromExpiry,
  worthGroupOf,
  type Orderable,
} from "../../../../src/lib/suggest/score.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const PREFS = defaultPreferences();

function hoursOut(hours: number): string {
  return new Date(NOW + hours * HOUR).toISOString();
}

function worthOf(name: string): number {
  return rewardValue(PREFS, name) ?? 0;
}

function orderable(name: string, hours: number | null, effort = 0.2): Orderable {
  return {
    signals: { value: worthOf(name), effort, urgency: 0 },
    details: hours === null ? undefined : { expiry: hoursOut(hours) },
  };
}

describe("clamp01", () => {
  it("pins values into 0..1 and treats junk as 0", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(9)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("urgencyFromExpiry", () => {
  it("has none without a usable expiry", () => {
    expect(urgencyFromExpiry(null, NOW)).toBe(0);
    expect(urgencyFromExpiry(undefined, NOW)).toBe(0);
    expect(urgencyFromExpiry("not a date", NOW)).toBe(0);
  });

  it("climbs as the window closes", () => {
    const far = urgencyFromExpiry(hoursOut(20), NOW, DAY);
    const near = urgencyFromExpiry(hoursOut(6), NOW, DAY);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(1);
    expect(far).toBeGreaterThan(0);
  });

  it("measures against the window's own length, so a weekly is not written off", () => {
    // The 72 hour constant scored this exactly zero for the first four days of
    // every week, which is what inverted the whole feed.
    expect(urgencyFromExpiry(hoursOut(96), NOW, WEEK)).toBeGreaterThan(0);
    expect(urgencyFromExpiry(hoursOut(96), NOW, WEEK)).toBeCloseTo(1 - 96 / 168, 10);
  });

  it("puts a fresh daily and a fresh weekly at the same urgency", () => {
    expect(urgencyFromExpiry(hoursOut(24), NOW, DAY)).toBe(
      urgencyFromExpiry(hoursOut(168), NOW, WEEK),
    );
    expect(urgencyFromExpiry(hoursOut(12), NOW, DAY)).toBe(
      urgencyFromExpiry(hoursOut(84), NOW, WEEK),
    );
  });

  it("scores an expired window at zero rather than maximum", () => {
    expect(urgencyFromExpiry(hoursOut(-1), NOW, DAY)).toBe(0);
  });

  it("falls back to a fixed horizon for a caller that names no window", () => {
    expect(urgencyFromExpiry(hoursOut(100), NOW)).toBe(0);
    expect(urgencyFromExpiry(hoursOut(36), NOW)).toBeCloseTo(0.5, 10);
  });
});

describe("effectiveWorth", () => {
  it("is worth against gain, with an absent gain reading as one", () => {
    expect(effectiveWorth({ value: 0.8, effort: 0, urgency: 0 })).toBeCloseTo(0.8, 10);
    expect(effectiveWorth({ value: 0.8, effort: 0, urgency: 0, gain: 0.5 })).toBeCloseTo(0.4, 10);
    expect(effectiveWorth({ value: 0.8, effort: 0, urgency: 0, gain: 0 })).toBe(0);
  });

  it("bands a suggestion by what it is actually worth to this player", () => {
    expect(
      worthGroupOf({ signals: { value: worthOf("Umbra Forma"), effort: 0, urgency: 0 } }),
    ).toBe("must");
    expect(
      worthGroupOf({
        signals: { value: worthOf("Umbra Forma"), effort: 0, urgency: 0, gain: 0.5 },
      }),
    ).toBe("useful");
  });
});

describe("timeLeftMs", () => {
  it("reads the window off the details the card already carries", () => {
    expect(timeLeftMs(orderable("Kuva", 3), NOW)).toBe(3 * HOUR);
  });

  it("reads no deadline, and one already past, as forever", () => {
    expect(timeLeftMs(orderable("Kuva", null), NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(timeLeftMs(orderable("Kuva", -2), NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(timeLeftMs({ signals: { value: 1, effort: 0, urgency: 0 } }, NOW)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("bandFor", () => {
  it("bands a card by its worth group, whatever its window", () => {
    expect(bandFor(orderable("Umbra Forma", 5))).toBe(1);
    expect(bandFor(orderable("Umbra Forma", 100))).toBe(1);
    expect(bandFor(orderable("Umbra Forma", null))).toBe(1);
  });

  it("reads one band per ladder group, best first", () => {
    expect(bandFor(orderable("Forma", 20))).toBe(2);
    expect(bandFor(orderable("Kuva", 20))).toBe(3);
    expect(bandFor(orderable("Focus Points", 1))).toBe(4);
    expect(bandFor(orderable("Credits", 1))).toBe(5);
  });

  it("never lets a closing window lift a lesser reward past a better one", () => {
    // A want-band weapon rotation four hours from rerolling used to land in
    // band one, above every Archon Shard task with days of its week left.
    expect(bandFor(orderable("Forma", 4))).toBeGreaterThan(bandFor(orderable("Umbra Forma", 500)));
    expect(bandFor(orderable("Kuva", 1))).toBeGreaterThan(bandFor(orderable("Forma", 500)));
  });
});

describe("orderingScore", () => {
  it("agrees with the bands, best first", () => {
    expect(orderingScore(orderable("Umbra Forma", 100), NOW)).toBeGreaterThan(
      orderingScore(orderable("Forma", 5), NOW),
    );
    expect(orderingScore(orderable("Forma", 500), NOW)).toBeGreaterThan(
      orderingScore(orderable("Kuva", 1), NOW),
    );
  });

  it("orders nothing by effort", () => {
    expect(orderingScore(orderable("Kuva", 20, 0), NOW)).toBe(
      orderingScore(orderable("Kuva", 20, 1), NOW),
    );
    expect(orderingScore(orderable("Umbra Forma", 100, 1), NOW)).toBeGreaterThan(
      orderingScore(orderable("Kuva", 100, 0), NOW),
    );
  });

  it("ranks a turned-down suggestion below everything else", () => {
    const turnedDown = { ...orderable("Umbra Forma", 1), deprioritized: true };
    expect(orderingScore(turnedDown, NOW)).toBeLessThan(
      orderingScore(orderable("Credits", 500), NOW),
    );
  });
});

describe("DEFAULT_WEIGHTS", () => {
  it("is what the preferences ship", () => {
    expect(defaultPreferences().weights).toEqual(DEFAULT_WEIGHTS);
  });
});
