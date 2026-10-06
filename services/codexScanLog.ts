import fs from "node:fs";

import { writeFileAtomicSync } from "./atomicFile";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";
import { CODEX_SCAN_LOG_CAP, appendCappedLines } from "../config/shared/codexScanLog";
import type { CodexScanLogLine } from "../config/shared/codexScanLog";

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
