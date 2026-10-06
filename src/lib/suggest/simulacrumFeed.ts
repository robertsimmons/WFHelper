import {
  CODEX_EXTRA_INFO,
  CODEX_SCAN_REQUIREMENTS,
  CODEX_STAR_CHART_NODES,
} from "../../data/codexScanRequirements.js";
import { CODEX_FACTIONS, buildCodexRows } from "../codexScans.js";
import { missingScannables, type LoreScan, type MissingScannables } from "./scannables.js";
import { simulacrumCards, type SimulacrumCard } from "./simulacrum.js";
import type { CodexScanEntry } from "../../../config/shared/codexTypes.js";

export { enemyImageUrl } from "../codexScans.js";

interface SimulacrumFeed {
  cards: SimulacrumCard[];
  /** Codex tab label by row type. */
  factions: ReadonlyMap<string, string>;
  /** Merges the inventory's lore scans, which load apart from the profile's. */
  scannables: (lore: readonly LoreScan[]) => MissingScannables;
}

export function simulacrumFeed(scans: CodexScanEntry[]): SimulacrumFeed {
  const rows = buildCodexRows(scans);
  const planets = new Set(CODEX_STAR_CHART_NODES.map((node) => node.planet));
  const labels = new Map(CODEX_FACTIONS.map((faction) => [faction.key, faction.label]));
  const factions = new Map<string, string>();
  for (const row of rows) {
    if (row.faction) factions.set(row.type, labels.get(row.faction) ?? row.faction);
  }
  return {
    cards: simulacrumCards(rows, CODEX_SCAN_REQUIREMENTS, CODEX_STAR_CHART_NODES),
    factions,
    scannables: (lore) => missingScannables(rows, CODEX_EXTRA_INFO, lore, planets),
  };
}
