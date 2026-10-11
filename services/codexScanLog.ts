import fs from "node:fs";

import { writeFileAtomicSync } from "./atomicFile";
import { createJsonCache } from "./jsonCache";
import { withScope } from "./logger";
import * as notificationLog from "./notificationLog";
import { userDataPath } from "./userDataPath";
import {
  CODEX_SCAN_LOG_CAP,
  appendCappedLines,
  recentCodexScanLines,
} from "../config/shared/codexScanLog";
import { CODEX_PROGRESS_TITLE, codexProgressBody } from "../config/shared/codexScanProgress";
import type { CodexScanHistoryLine, CodexScanLogLine } from "../config/shared/codexScanLog";
import type { NotificationEntry } from "../config/shared/notifications";

const log = withScope("codexScanLog");

const LOG_FILE = "codex-scan-log.jsonl";

export function appendCodexScanLog(line: CodexScanLogLine): void {
  const filePath = userDataPath(LOG_FILE);
  let existing = "";
  try {
    existing = fs.readFileSync(filePath, "utf8");
  } catch {
    // first line
  }
  try {
    writeFileAtomicSync(
      filePath,
      appendCappedLines(existing, JSON.stringify(line), CODEX_SCAN_LOG_CAP),
    );
  } catch (err) {
    log.warn(`Failed to write ${LOG_FILE}`, err);
  }
}

const BACKFILL_LINES = 10;

const backfillFlag = createJsonCache<{ done: true }>(
  "codex-scan-history-backfill.json",
  (parsed) => ((parsed as { done?: unknown } | null)?.done === true ? { done: true } : null),
);

function historyEntry(line: CodexScanHistoryLine): NotificationEntry {
  const completed = line.rows.filter((row) => row.completedNow).length;
  const newScans = line.rows.reduce((sum, row) => sum + Math.max(0, row.after - row.before), 0);
  return {
    id: `codex-${line.fetchedAt.toString(36)}`,
    at: line.at,
    kind: "app",
    title: CODEX_PROGRESS_TITLE,
    body: codexProgressBody(completed, newScans),
    codexScans: line.rows,
  };
}

/** One-time: the history predates per-row detail, so the newest log lines are
 *  replayed into it. Ids derive from fetchedAt, so a crash before the flag
 *  lands cannot duplicate them either. */
export function backfillCodexScanHistory(): void {
  if (backfillFlag.read()) return;
  let text = "";
  try {
    text = fs.readFileSync(userDataPath(LOG_FILE), "utf8");
  } catch {
    // no log yet
  }
  try {
    notificationLog.backfill(recentCodexScanLines(text, BACKFILL_LINES).map(historyEntry));
    backfillFlag.write({ done: true });
  } catch (err) {
    log.warn("Codex scan history backfill failed", err);
  }
}
