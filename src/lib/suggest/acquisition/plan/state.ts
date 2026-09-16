import { aggregateComponentOwnership } from "../../../../../config/shared/componentOwnership.js";
import { collectRelicInventoryCounts } from "../../../../../config/shared/relicCounts.js";
import {
  pendingBuildCounts,
  withoutFoundryPending,
} from "../../../../../config/shared/foundryPending.js";
import { dailyStandingCap } from "../../../syndicates/rankup.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../types/inventory.js";

const GROUPED = /^\d{1,3}(?:,\d{3})*$|^\d+$/;
const BLUEPRINT_SUFFIX = / blueprint$/i;
const RELIC_SUFFIX = / relic$/i;
const RELIC_QUALITY_SUFFIX = /\s*\((intact|exceptional|flawless|radiant)\)$/i;
const STANDING_SUFFIX = / standing$/i;

export function parseQuantity(text: string | null): number {
  if (!text || !GROUPED.test(text)) return 1;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : 1;
}

export function formatQuantity(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function addName(index: Map<string, string[]>, name: unknown, uniqueName: string): void {
  if (typeof name !== "string" || name === "") return;
  const key = name.trim().toLowerCase();
  const rows = index.get(key);
  if (rows) rows.push(uniqueName);
  else index.set(key, [uniqueName]);
}

function buildNameIndex(itemDb: Record<string, ItemDbEntry>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [uniqueName, entry] of Object.entries(itemDb ?? {})) {
    addName(index, entry?.name, uniqueName);
    addName(index, entry?.displayName, uniqueName);
  }
  return index;
}

function buildRelicIndex(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): Map<string, number> {
  const held = new Map<string, number>();
  if (!inventory) return held;
  for (const [uniqueName, count] of collectRelicInventoryCounts(
    inventory as unknown as Record<string, unknown>,
  )) {
    const raw = itemDb[uniqueName]?.name;
    if (typeof raw !== "string") continue;
    const key = raw
      .replace(RELIC_QUALITY_SUFFIX, "")
      .replace(RELIC_SUFFIX, "")
      .trim()
      .toLowerCase();
    held.set(key, (held.get(key) ?? 0) + count);
  }
  return held;
}

export interface PendingBuild {
  name: string;
  /** Null when the payload carried no completion date for the build. */
  endsAt: number | null;
}

function parseCompletionDate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value !== "object") return null;
  const wrapped = (value as { $date?: unknown }).$date ?? value;
  if (typeof wrapped === "object" && wrapped !== null && "$numberLong" in wrapped) {
    const ms = Number((wrapped as { $numberLong: unknown }).$numberLong);
    return Number.isFinite(ms) ? ms : null;
  }
  return parseCompletionDate(wrapped);
}

/** Item names the foundry is actually running a build for. A blueprint sitting
 *  unbuilt is not a started timer, which is the whole point of the waiting rule. */
function buildPendingIndex(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): Map<string, PendingBuild> {
  const pending = new Map<string, PendingBuild>();
  if (!inventory) return pending;

  const endByBlueprint = new Map<string, number | null>();
  for (const entry of inventory.PendingRecipes ?? []) {
    const itemType = typeof entry?.ItemType === "string" ? entry.ItemType : "";
    if (itemType) endByBlueprint.set(itemType, parseCompletionDate(entry.CompletionDate));
  }

  const counts = pendingBuildCounts(
    inventory.PendingRecipes,
    (uniqueName) => itemDb[uniqueName]?.buildsProduct ?? null,
  );

  for (const uniqueName of counts.keys()) {
    const name = itemDb[uniqueName]?.name;
    if (typeof name !== "string" || name === "") continue;
    const blueprint = itemDb[uniqueName]?.buildsProduct
      ? uniqueName
      : [...endByBlueprint.keys()].find((key) => itemDb[key]?.buildsProduct === uniqueName);
    const endsAt = blueprint ? (endByBlueprint.get(blueprint) ?? null) : null;
    const key = name.replace(BLUEPRINT_SUFFIX, "").trim().toLowerCase();
    const held = pending.get(key);
    // The blueprint and what it builds land on the same key; the product is the
    // name the player recognises, and the blueprint is the one with the clock.
    if (!held) pending.set(key, { name, endsAt });
    else if (BLUEPRINT_SUFFIX.test(held.name) && !BLUEPRINT_SUFFIX.test(name)) {
      pending.set(key, { name, endsAt: held.endsAt ?? endsAt });
    }
  }
  return pending;
}

function readStanding(inventory: RawInventoryData | null): Map<string, number> {
  const balances = new Map<string, number>();
  const rows = inventory?.Affiliations;
  if (!Array.isArray(rows)) return balances;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as { Tag?: unknown; Standing?: unknown };
    if (typeof record.Tag !== "string") continue;
    const standing = typeof record.Standing === "number" ? record.Standing : 0;
    balances.set(record.Tag, standing);
  }
  return balances;
}

/** Everything resolution reads off the player, indexed once per plan. */
export interface PlayerState {
  owned: Map<string, number>;
  names: Map<string, string[]>;
  relics: Map<string, number>;
  pending: Map<string, PendingBuild>;
  standing: Map<string, number>;
  standingCap: number;
}

export function readPlayerState(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): PlayerState {
  const db = itemDb ?? {};
  const usable = inventory
    ? withoutFoundryPending(
        inventory as unknown as Record<string, unknown>,
        (uniqueName) => db[uniqueName]?.reusableBlueprint === true,
      )
    : {};
  return {
    owned: aggregateComponentOwnership(usable),
    names: buildNameIndex(db),
    relics: buildRelicIndex(inventory, db),
    pending: buildPendingIndex(inventory, db),
    standing: readStanding(inventory),
    standingCap: dailyStandingCap(inventory),
  };
}

function candidates(label: string, itemName: string): string[] {
  const bare = label.replace(BLUEPRINT_SUFFIX, "").trim();
  const out = [label, `${itemName} ${label}`];
  if (bare !== label) out.push(bare, `${itemName} ${bare}`);
  return out;
}

/** Copies of what a row asks for, or null when nothing in the inventory answers
 *  the label. Null is unknown, and an unknown row is never silently done. */
export function ownedForLabel(state: PlayerState, label: string, itemName: string): number | null {
  const relic = state.relics.get(label.replace(RELIC_SUFFIX, "").trim().toLowerCase());
  if (relic !== undefined) return relic;

  for (const candidate of candidates(label, itemName)) {
    const matches = state.names.get(candidate.trim().toLowerCase());
    if (!matches) continue;
    let total = 0;
    for (const uniqueName of matches) total += state.owned.get(uniqueName) ?? 0;
    return total;
  }
  return null;
}

export function pendingBuildFor(
  state: PlayerState,
  label: string,
  itemName: string,
): PendingBuild | null {
  for (const candidate of candidates(label, itemName)) {
    const match = state.pending.get(candidate.trim().toLowerCase());
    if (match) return match;
  }
  return null;
}

const SYNDICATE_TAGS: Record<string, string> = {
  ostrons: "CetusSyndicate",
  "solaris united": "SolarisSyndicate",
  entrati: "EntratiSyndicate",
  "the holdfasts": "ZarimanSyndicate",
  "the hex": "HexSyndicate",
  cavia: "EntratiLabSyndicate",
};

/** "Solaris United standing" -> the affiliation tag that holds its balance. */
function standingTag(currency: string): string | null {
  if (!STANDING_SUFFIX.test(currency)) return null;
  const name = currency.replace(STANDING_SUFFIX, "").trim();
  return SYNDICATE_TAGS[name.toLowerCase()] ?? name;
}

export function standingBalance(state: PlayerState, currency: string): number | null {
  const tag = standingTag(currency);
  if (!tag) return null;
  return state.standing.get(tag) ?? null;
}
