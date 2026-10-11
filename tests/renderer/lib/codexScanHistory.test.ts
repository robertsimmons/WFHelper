import { describe, expect, it } from "vitest";

import { buildScanDetailRows, scanLocations, scanSummary } from "../../../src/lib/codexScanHistory";
import type { CodexScanLogRow } from "../../../config/shared/codexScanLog";

function row(type: string, before: number, after: number, completedNow = false): CodexScanLogRow {
  return { type, name: type, before, after, required: 20, completedNow };
}

describe("codex scan history rows", () => {
  it("sorts finished first, then by the biggest jump", () => {
    const rows = [row("a", 0, 2), row("b", 0, 9), row("c", 18, 20, true), row("d", 1, 2)];

    expect(buildScanDetailRows(rows, () => null).map((entry) => entry.type)).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });

  it("falls back to the codex name, then the path tail, and keeps unknown rows", () => {
    const rows = [
      { ...row("/Lotus/Types/Enemies/Grineer/Lancer", 0, 1), name: null },
      { ...row("/Lotus/Objects/Thing", 0, 1), name: null, required: null },
    ];
    const built = buildScanDetailRows(rows, (type) =>
      type.endsWith("Lancer") ? { name: "Lancer", image: "x.png", locations: ["Earth"] } : null,
    );

    expect(built).toEqual([
      expect.objectContaining({ name: "Lancer", image: "x.png", locations: ["Earth"] }),
      expect.objectContaining({ name: "Thing", image: null, locations: [], required: null }),
    ]);
  });

  it("summarises completions, new scans and rows", () => {
    expect(scanSummary([row("a", 0, 2), row("b", 18, 20, true)])).toEqual({
      completed: 1,
      newScans: 4,
      enemies: 2,
    });
  });

  it("lists planets then tilesets, with missions only as a fallback", () => {
    expect(scanLocations(["Earth", "Mars"], ["Grineer Forest", "Earth"], ["Survival"])).toEqual([
      "Earth",
      "Mars",
      "Grineer Forest",
    ]);
    expect(scanLocations([], [], ["Survival"])).toEqual(["Survival"]);
  });
});
