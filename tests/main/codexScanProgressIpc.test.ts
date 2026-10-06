import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  dispatched: [] as unknown[],
  sent: [] as { title: string; body: string }[],
  stored: null as unknown,
  writes: 0,
  account: "aaaaaaaaaaaaaaaaaaaaaaaa" as string | null,
  cached: null as { fetchedAt: number; scans: { type: string; count: number }[] } | null,
  logged: [] as unknown[],
}));

vi.mock("../../ipc/ipcSecurity", () => ({
  assertMainRendererSender: vi.fn(),
  handleAuthorized: (channel: string, _assert: unknown, handler: Handler) => {
    h.handlers.set(channel, handler);
  },
}));

vi.mock("../../ipc/worldStateIpc", () => ({
  sendDesktopNotificationRaw: (title: string, body: string) => {
    h.sent.push({ title, body });
  },
}));

vi.mock("../../services/notificationChannels", () => ({
  dispatch: (payload: unknown, deliverNative?: () => void) => {
    h.dispatched.push(payload);
    deliverNative?.();
  },
}));

vi.mock("../../services/codexProfile", () => ({
  codexAccountId: () => h.account,
  cachedCodexScans: () => h.cached,
}));

vi.mock("../../services/codexScanLog", () => ({
  appendCodexScanLog: (line: unknown) => {
    h.logged.push(line);
  },
}));

vi.mock("../../services/jsonCache", () => ({
  createJsonCache: (_name: string, revive: (parsed: unknown) => unknown) => ({
    read: () => (h.stored === null ? null : revive(JSON.parse(JSON.stringify(h.stored)))),
    write: (payload: unknown) => {
      h.writes += 1;
      h.stored = JSON.parse(JSON.stringify(payload));
    },
  }),
}));

const TYPE = "/Lotus/Types/Enemies/Grineer/Butcher";

async function setup(): Promise<Handler> {
  vi.resetModules();
  h.handlers.clear();
  const ipc = await import("../../ipc/codexScanProgressIpc");
  ipc.register();
  return h.handlers.get("codex-scan-progress") as Handler;
}

describe("codex scan progress IPC", () => {
  let handler: Handler;

  beforeEach(async () => {
    h.dispatched.length = 0;
    h.sent.length = 0;
    h.stored = null;
    h.writes = 0;
    h.account = "aaaaaaaaaaaaaaaaaaaaaaaa";
    h.cached = null;
    h.logged.length = 0;
    handler = await setup();
  });

  it("logs row and raw deltas after the baseline, carrying raw in the snapshot", () => {
    const RAW = "/Lotus/Types/Enemies/Corpus/Spaceman/VenusHeavyEliteSpacemanAvatar";
    h.cached = { fetchedAt: 1, scans: [{ type: RAW, count: 1289 }] };
    handler({}, { fetchedAt: 1, rows: [{ type: TYPE, scanned: 5, complete: false }] });
    expect(h.logged).toEqual([]);
    expect((h.stored as Record<string, { raw: unknown }>)[h.account as string].raw).toEqual({
      [RAW]: 1289,
    });

    h.cached = { fetchedAt: 2, scans: [{ type: RAW, count: 1400 }] };
    const row = { type: TYPE, scanned: 9, complete: false, name: "Butcher", required: 20 };
    handler({}, { fetchedAt: 2, rows: [row] });
    expect(h.logged).toEqual([
      {
        at: expect.any(String),
        fetchedAt: 2,
        rows: [
          { type: TYPE, name: "Butcher", before: 5, after: 9, required: 20, completedNow: false },
        ],
        raw: [{ type: RAW, before: 1289, after: 1400 }],
      },
    ]);
  });

  it("logs a raw-only change even when no row moved", () => {
    const RAW = "/Lotus/Types/Enemies/Orokin/HeliosScanTarget";
    h.cached = { fetchedAt: 1, scans: [{ type: RAW, count: 3 }] };
    handler({}, { fetchedAt: 1, rows: [{ type: TYPE, scanned: 5, complete: false }] });
    h.cached = { fetchedAt: 2, scans: [{ type: RAW, count: 8 }] };
    handler({}, { fetchedAt: 2, rows: [{ type: TYPE, scanned: 5, complete: false }] });
    expect(h.dispatched).toEqual([]);
    expect(h.logged).toMatchObject([{ rows: [], raw: [{ type: RAW, before: 3, after: 8 }] }]);
  });

  it("sets the baseline silently, then notifies on progress", () => {
    expect(handler({}, { fetchedAt: 1, rows: [{ type: TYPE, scanned: 5, complete: false }] })).toBe(
      true,
    );
    expect(h.dispatched).toEqual([]);
    handler({}, { fetchedAt: 2, rows: [{ type: TYPE, scanned: 20, complete: true }] });
    expect(h.sent).toEqual([
      { title: "Scanning Progress", body: "1 enemy completed, 15 new scans" },
    ]);
    expect(h.dispatched).toEqual([
      { source: "codexScans", title: "Scanning Progress", body: "1 enemy completed, 15 new scans" },
    ]);
  });

  it("leaves the snapshot alone for data no newer than it", () => {
    handler({}, { fetchedAt: 5, rows: [{ type: TYPE, scanned: 5, complete: false }] });
    expect(handler({}, { fetchedAt: 5, rows: [{ type: TYPE, scanned: 9, complete: false }] })).toBe(
      false,
    );
    expect(h.writes).toBe(1);
    expect(h.dispatched).toEqual([]);
  });

  it("keeps one snapshot per account", async () => {
    handler({}, { fetchedAt: 1, rows: [{ type: TYPE, scanned: 5, complete: false }] });
    h.account = "bbbbbbbbbbbbbbbbbbbbbbbb";
    handler = await setup();
    handler({}, { fetchedAt: 2, rows: [{ type: TYPE, scanned: 9, complete: false }] });
    expect(h.dispatched).toEqual([]);
    expect(Object.keys(h.stored as object)).toHaveLength(2);
  });

  it.each([
    ["no account", null, { fetchedAt: 1, rows: [] }],
    ["a missing payload", "aaaaaaaaaaaaaaaaaaaaaaaa", undefined],
    ["a bad fetchedAt", "aaaaaaaaaaaaaaaaaaaaaaaa", { fetchedAt: "1", rows: [] }],
    [
      "a bad row",
      "aaaaaaaaaaaaaaaaaaaaaaaa",
      { fetchedAt: 1, rows: [{ type: TYPE, scanned: -1, complete: false }] },
    ],
  ])("rejects %s", (_label, account, payload) => {
    h.account = account;
    expect(handler({}, payload)).toBe(false);
    expect(h.writes).toBe(0);
  });
});
