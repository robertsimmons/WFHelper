import { describe, expect, it } from "vitest";

import { clamp01, scoreSignals, urgencyFromExpiry } from "../../../../src/lib/suggest/score.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");

function hoursOut(hours: number): string {
  return new Date(NOW + hours * 60 * 60_000).toISOString();
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
    const far = urgencyFromExpiry(hoursOut(48), NOW);
    const near = urgencyFromExpiry(hoursOut(6), NOW);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(1);
    expect(far).toBeGreaterThan(0);
  });

  it("ignores deadlines past the horizon", () => {
    expect(urgencyFromExpiry(hoursOut(100), NOW)).toBe(0);
  });

  it("scores an expired window at zero rather than maximum", () => {
    expect(urgencyFromExpiry(hoursOut(-1), NOW)).toBe(0);
  });
});

describe("scoreSignals", () => {
  it("rewards value and urgency, penalises effort", () => {
    const base = scoreSignals({ value: 0.5, effort: 0, urgency: 0 });
    expect(scoreSignals({ value: 0.9, effort: 0, urgency: 0 })).toBeGreaterThan(base);
    expect(scoreSignals({ value: 0.5, effort: 0, urgency: 0.8 })).toBeGreaterThan(base);
    expect(scoreSignals({ value: 0.5, effort: 0.8, urgency: 0 })).toBeLessThan(base);
  });

  it("clamps its inputs so a wild signal cannot dominate", () => {
    expect(scoreSignals({ value: 50, effort: 0, urgency: 0 })).toBe(
      scoreSignals({ value: 1, effort: 0, urgency: 0 }),
    );
  });
});
