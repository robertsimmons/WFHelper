import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-codex-backfill-"));
const scanLog = path.join(tempDir, "codex-scan-log.jsonl");
const historyFile = path.join(tempDir, "notification-log.json");
const flagFile = path.join(tempDir, "codex-scan-history-backfill.json");

vi.mock("electron", () => ({
  app: { getPath: () => tempDir },
}));

const BUTCHER = "/Lotus/Types/Enemies/Grineer/Butcher";

function row(after: number, completedNow = false) {
  return { type: BUTCHER, name: "Butcher", before: 5, after, required: 20, completedNow };
}

function line(fetchedAt: number, rows: unknown[]): string {
  const at = new Date(Date.UTC(2026, 9, 1, 0, fetchedAt)).toISOString();
  return JSON.stringify({ at, fetchedAt, rows, raw: [] });
}

async function backfill() {
  vi.resetModules();
  const service = await import("../../services/codexScanLog");
  service.backfillCodexScanHistory();
  return (await import("../../services/notificationLog")).getAll();
}

beforeEach(() => {
  for (const file of [scanLog, historyFile, flagFile]) fs.rmSync(file, { force: true });
});

describe("codex scan history backfill", () => {
  it("replays the last ten lines with rows, newest first", async () => {
    const lines = Array.from({ length: 12 }, (_, index) => line(index + 1, [row(6 + index)]));
    lines[11] = line(12, []);
    lines[10] = line(11, [row(20, true)]);
    fs.writeFileSync(scanLog, `${lines.join("\n")}\n`);

    const entries = await backfill();

    expect(entries.map((entry) => entry.id)).toEqual(
      [11, 10, 9, 8, 7, 6, 5, 4, 3].map((at) => `codex-${at.toString(36)}`),
    );
    expect(entries[0]).toMatchObject({
      at: new Date(Date.UTC(2026, 9, 1, 0, 11)).toISOString(),
      kind: "app",
      title: "Scanning Progress",
      body: "1 enemy completed, 15 new scans",
      codexScans: [row(20, true)],
    });
  });

  it("runs once, so a restart or a cleared history never brings entries back", async () => {
    fs.writeFileSync(scanLog, `${line(1, [row(9)])}\n`);
    expect(await backfill()).toHaveLength(1);

    fs.writeFileSync(historyFile, "[]");
    expect(await backfill()).toEqual([]);
  });

  it("does not duplicate entries when the flag never landed", async () => {
    fs.writeFileSync(scanLog, `${line(1, [row(9)])}\n`);
    await backfill();
    fs.rmSync(flagFile);

    expect(await backfill()).toHaveLength(1);
  });

  it("sets the flag when there is no log yet", async () => {
    expect(await backfill()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(flagFile, "utf8"))).toEqual({ done: true });
  });
});
