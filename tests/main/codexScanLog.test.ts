import { describe, expect, it } from "vitest";

import {
  appendCappedLines,
  codexScanLogLine,
  diffRawScans,
  rawScanCounts,
} from "../../config/shared/codexScanLog";
import { snapshotCodexProgress } from "../../config/shared/codexScanProgress";
import type { CodexProgressRow } from "../../config/shared/codexScanProgress";

const BUTCHER = "/Lotus/Types/Enemies/Grineer/Butcher";
const LANCER = "/Lotus/Types/Enemies/Grineer/Lancer";
const CREWMAN = "/Lotus/Types/Enemies/Corpus/Spaceman/VenusHeavyEliteSpacemanAvatar";
const NOW = new Date("2026-10-05T12:00:00.000Z");

function row(type: string, scanned: number, complete = false): CodexProgressRow {
  return { type, scanned, complete, name: type.split("/").pop(), required: 20 };
}

const PREVIOUS = {
  ...snapshotCodexProgress(1, [row(BUTCHER, 10), row(LANCER, 20, true)]),
  raw: { [BUTCHER]: 10, [LANCER]: 20, [CREWMAN]: 1289 },
};

describe("codexScanLogLine", () => {
  it("writes nothing for the baseline", () => {
    expect(codexScanLogLine(null, 1, [row(BUTCHER, 10)], { [BUTCHER]: 10 }, NOW)).toBeNull();
  });

  it("writes nothing when no count went up", () => {
    const rows = [row(BUTCHER, 7), row(LANCER, 20, true)];
    const raw = { [BUTCHER]: 7, [LANCER]: 20, [CREWMAN]: 1289 };
    expect(codexScanLogLine(PREVIOUS, 2, rows, raw, NOW)).toBeNull();
  });

  it("captures row and raw increases, skipping falling and unchanged ones", () => {
    const rows = [row(BUTCHER, 20, true), row(LANCER, 19, true)];
    const raw = { [BUTCHER]: 20, [LANCER]: 19, [CREWMAN]: 1300, "/Lotus/New": 2 };
    expect(codexScanLogLine(PREVIOUS, 2, rows, raw, NOW)).toEqual({
      at: "2026-10-05T12:00:00.000Z",
      fetchedAt: 2,
      rows: [
        { type: BUTCHER, name: "Butcher", before: 10, after: 20, required: 20, completedNow: true },
      ],
      raw: [
        { type: BUTCHER, before: 10, after: 20 },
        { type: CREWMAN, before: 1289, after: 1300 },
        { type: "/Lotus/New", before: 0, after: 2 },
      ],
    });
  });

  it("logs rows alone when either raw list is missing", () => {
    const { raw: _raw, ...noRaw } = PREVIOUS;
    const line = codexScanLogLine(noRaw, 2, [row(BUTCHER, 12)], { [BUTCHER]: 12 }, NOW);
    expect(line).toMatchObject({ rows: [{ type: BUTCHER, before: 10, after: 12 }], raw: [] });
    expect(codexScanLogLine(PREVIOUS, 2, [row(BUTCHER, 12)], null, NOW)?.raw).toEqual([]);
  });
});

describe("diffRawScans", () => {
  it("keeps increases only", () => {
    expect(diffRawScans({ a: 5, b: 5 }, { a: 6, b: 4, c: 1 })).toEqual([
      { type: "a", before: 5, after: 6 },
      { type: "c", before: 0, after: 1 },
    ]);
  });

  it("maps profile entries by type", () => {
    expect(rawScanCounts([{ type: CREWMAN, count: 1289 }])).toEqual({ [CREWMAN]: 1289 });
  });
});

describe("appendCappedLines", () => {
  it("appends to an empty file", () => {
    expect(appendCappedLines("", "{}", 200)).toBe("{}\n");
  });

  it("trims to the cap, dropping the oldest lines", () => {
    const existing = ["1", "2", "3"].map((n) => `{"n":${n}}`).join("\n") + "\n";
    expect(appendCappedLines(existing, '{"n":4}', 3)).toBe('{"n":2}\n{"n":3}\n{"n":4}\n');
  });
});
