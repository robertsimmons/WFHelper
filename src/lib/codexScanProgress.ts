import { invoke } from "./ipc.js";
import { log } from "./log.js";
import type { CodexProgressRow } from "../../config/shared/codexScanProgress.js";
import type { CodexScanEntry } from "../../config/shared/codexTypes.js";

/** Main diffs these rows against the account's last snapshot and posts the bell
 *  entry; unscanned rows are left out since a missing row counts from zero. */
export async function reportCodexScanProgress(fetchedAt: number, scans: CodexScanEntry[]) {
  try {
    const { buildCodexRows } = await import("./codexScans.js");
    const rows: CodexProgressRow[] = [];
    for (const row of buildCodexRows(scans)) {
      if (row.scanned > 0) {
        rows.push({
          type: row.type,
          scanned: row.scanned,
          complete: row.complete === true,
          name: row.name,
          required: row.required,
        });
      }
    }
    await invoke("reportCodexScanProgress", { fetchedAt, rows });
  } catch (err) {
    log.warn("[Codex] scan progress report failed:", err);
  }
}
