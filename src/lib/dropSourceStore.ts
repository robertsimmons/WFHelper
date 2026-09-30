import { readable, type Readable } from "svelte/store";

import { dropSourcesFor, type DropSource } from "./dropSources.js";
import { loadEnemyInfo } from "./enemies/enemyInfoLazy.js";
import {
  codexEnemyLookup,
  isUnplacedDrop,
  withEnemySpawns,
  type EnemyLookup,
} from "./enemySpawns.js";
import { invoke } from "./ipc.js";
import type { DropRow } from "../../config/shared/dropTypes.js";
import type { DropInfo } from "../types/inventory.js";

/** Only a levelled bounty ever loses its stage upstream. */
const BOUNTY_LOCATION = /Level\s+\d+\s*-\s*\d+\s+[^)\s]/i;

const rowsByName = new Map<string, Promise<DropRow[]>>();

function bountyRows(name: string): Promise<DropRow[]> {
  const key = name.toLowerCase();
  const held = rowsByName.get(key);
  if (held) return held;
  const request = Promise.resolve()
    .then(() => invoke("searchDrops", name, "item"))
    .then((result) =>
      result.rows.filter((row) => row.kind === "bounty" && row.item.toLowerCase() === key),
    )
    .catch((): DropRow[] => []);
  rowsByName.set(key, request);
  // An empty answer is usually the table still loading; ask again next time.
  void request.then((rows) => {
    if (rows.length === 0 && rowsByName.get(key) === request) rowsByName.delete(key);
  });
  return request;
}

/** The drop table spells the reward in `type`; the item's own name covers the
 *  rows that carry none. */
function lookupNames(drops: readonly DropInfo[], name: string | null | undefined): string[] {
  const names = new Set<string>();
  for (const drop of drops) {
    if (typeof drop.location !== "string" || !BOUNTY_LOCATION.test(drop.location)) continue;
    if (typeof drop.stage === "string") continue;
    const spelled = typeof drop.type === "string" && drop.type.trim() ? drop.type.trim() : name;
    if (spelled?.trim()) names.add(spelled.trim());
  }
  return [...names];
}

let enemyLookup: Promise<EnemyLookup | null> | null = null;

function loadEnemyLookup(): Promise<EnemyLookup | null> {
  enemyLookup ??= loadEnemyInfo()
    .then(codexEnemyLookup)
    .catch(() => {
      enemyLookup = null;
      return null;
    });
  return enemyLookup;
}

/** An item's drop places, first as @wfcd has them, again once the stage-aware
 *  table has put each bounty chance back on its stage, and again once the
 *  codex has said where each enemy is fought. */
export function dropSourcesStore(
  drops: readonly DropInfo[] | null | undefined,
  name?: string | null,
): Readable<DropSource[]> {
  const list = drops ?? [];
  const initial = withEnemySpawns(dropSourcesFor(list), null);
  const names = lookupNames(list, name);
  const enemies = initial.some(isUnplacedDrop);
  if (names.length === 0 && !enemies) return readable(initial);
  return readable(initial, (set) => {
    let live = true;
    let rows: DropRow[] = [];
    let lookup: EnemyLookup | null = null;
    const emit = () => {
      if (live) set(withEnemySpawns(dropSourcesFor(list, rows), lookup));
    };
    if (names.length > 0) {
      void Promise.all(names.map(bountyRows)).then((groups) => {
        rows = groups.flat();
        if (rows.length > 0) emit();
      });
    }
    if (enemies) {
      void loadEnemyLookup().then((found) => {
        lookup = found;
        if (found) emit();
      });
    }
    return () => {
      live = false;
    };
  });
}
