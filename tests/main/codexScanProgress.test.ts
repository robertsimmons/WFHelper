import { describe, expect, it } from "vitest";

import {
  codexProgressBody,
  diffCodexProgress,
  snapshotCodexProgress,
} from "../../config/shared/codexScanProgress";
import type { CodexProgressRow } from "../../config/shared/codexScanProgress";

const BUTCHER = "/Lotus/Types/Enemies/Grineer/Butcher";
const LANCER = "/Lotus/Types/Enemies/Grineer/Lancer";
const BUTCHER_EXIMUS = `${BUTCHER}#leader`;

function row(type: string, scanned: number, complete = false): CodexProgressRow {
  return { type, scanned, complete };
}

const BEFORE = snapshotCodexProgress(1, [row(BUTCHER, 10), row(LANCER, 20, true)]);

describe("diffCodexProgress", () => {
  it("sets the baseline without reporting anything", () => {
    const diff = diffCodexProgress(null, 1, [row(BUTCHER, 10), row(LANCER, 20, true)]);
    expect(diff).toMatchObject({ completed: 0, newScans: 0 });
    expect(diff.snapshot).toEqual(BEFORE);
  });

  it("reports nothing when no count moved", () => {
    const diff = diffCodexProgress(BEFORE, 2, [row(BUTCHER, 10), row(LANCER, 20, true)]);
    expect(diff).toMatchObject({ completed: 0, newScans: 0 });
  });

  it("counts scan increases on unfinished rows", () => {
    const diff = diffCodexProgress(BEFORE, 2, [row(BUTCHER, 15), row(LANCER, 27, true)]);
    expect(diff).toMatchObject({ completed: 0, newScans: 12 });
  });

  it("counts a row crossing its requirement as completed", () => {
    const diff = diffCodexProgress(BEFORE, 2, [row(BUTCHER, 20, true), row(LANCER, 22, true)]);
    expect(diff).toMatchObject({ completed: 1, newScans: 12 });
  });

  it("counts every scan of a row first seen", () => {
    const rows = [row(BUTCHER, 10), row(LANCER, 20, true), row("/Lotus/New", 4)];
    expect(diffCodexProgress(BEFORE, 2, rows)).toMatchObject({ completed: 0, newScans: 4 });
  });

  it("ignores a falling count", () => {
    const diff = diffCodexProgress(BEFORE, 2, [row(BUTCHER, 7), row(LANCER, 21, true)]);
    expect(diff).toMatchObject({ completed: 0, newScans: 1 });
    expect(diff.snapshot.scans[BUTCHER]).toBe(7);
  });

  it("counts Eximus rows like any other", () => {
    const previous = snapshotCodexProgress(1, [row(BUTCHER, 10), row(BUTCHER_EXIMUS, 1)]);
    const rows = [row(BUTCHER, 10), row(BUTCHER_EXIMUS, 3, true)];
    expect(diffCodexProgress(previous, 2, rows)).toMatchObject({ completed: 1, newScans: 2 });
  });
});

describe("codexProgressBody", () => {
  it("names both parts", () => {
    expect(codexProgressBody(2, 12)).toBe("2 enemies completed, 12 new scans");
  });

  it("omits a zero part", () => {
    expect(codexProgressBody(0, 12)).toBe("12 new scans");
    expect(codexProgressBody(1, 0)).toBe("1 enemy completed");
  });
});
