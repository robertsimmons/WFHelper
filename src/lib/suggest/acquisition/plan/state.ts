import { aggregateComponentOwnership } from "../../../../../config/shared/componentOwnership.js";
import { collectRelicInventoryCounts } from "../../../../../config/shared/relicCounts.js";
import {
  pendingBuildCounts,
  withoutFoundryPending,
} from "../../../../../config/shared/foundryPending.js";
import { toFiniteNumber } from "../../../../../config/shared/numeric.js";
import { SYNDICATE_RANKS } from "../../../../data/syndicateRanks.js";
import { dailyStandingCap } from "../../../syndicates/rankup.js";
import { rankSyndicate } from "./ranks.js";
import type { ResourceLookup } from "./resources.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../types/inventory.js";

const GROUPED = /^\d{1,3}(?:,\d{3})*$|^\d+$/;
const BLUEPRINT_SUFFIX = / blueprint$/i;
const RELIC_SUFFIX = / relic$/i;
const RELIC_QUALITY_SUFFIX = /\s*\((intact|exceptional|flawless|radiant)\)$/i;
const STANDING_SUFFIX = / standing$/i;
const CREDITS = /^credits$/i;
const QUEST_SUFFIX = / quest$/i;
const LEADING_THE = /^the /i;
const QUEST_CHAIN_PREFIX = /^all main quests through /i;
const QUEST_CHAIN_SEPARATOR = ", then ";
/** DE files a quest's completion under its keychain, which the item database
 *  carries as an ordinary named entry beside real items. */
export const QUEST_KEYCHAIN = /^\/Lotus\/Types\/Keys\/.*KeyChain/;

export function parseQuantity(text: string | null): number {
  if (!text || !GROUPED.test(text)) return 1;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : 1;
}

export function formatQuantity(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

/** "Höllvanian" in the item database and "Hollvanian" in a plan name the same thing. */
function nameKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[‘’]/g, "'").trim().toLowerCase();
}

function addName(index: Map<string, string[]>, name: unknown, uniqueName: string): void {
  if (typeof name !== "string" || name === "") return;
  const key = nameKey(name);
  const rows = index.get(key);
  if (rows) {
    if (!rows.includes(uniqueName)) rows.push(uniqueName);
  } else index.set(key, [uniqueName]);
}

function buildNameIndex(itemDb: Record<string, ItemDbEntry>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [uniqueName, entry] of Object.entries(itemDb ?? {})) {
    addName(index, entry?.name, uniqueName);
    addName(index, entry?.displayName, uniqueName);
    // DE names a built frame part after its blueprint ("Ash Neuroptics
    // Blueprint"); the part's own name, which a foundry row uses, is only here.
    addName(index, entry?.partName, uniqueName);
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
    const key = nameKey(raw.replace(RELIC_QUALITY_SUFFIX, "").replace(RELIC_SUFFIX, ""));
    held.set(key, (held.get(key) ?? 0) + count);
  }
  return held;
}

interface PendingBuild {
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
    const key = nameKey(name.replace(BLUEPRINT_SUFFIX, ""));
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

/** Null when the payload carries no affiliations; a syndicate missing from one
 *  that does was never joined, which is a balance of none. */
function readStanding(inventory: RawInventoryData | null): Map<string, number> | null {
  const rows = inventory?.Affiliations;
  if (!Array.isArray(rows)) return null;
  const balances = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as { Tag?: unknown; Standing?: unknown };
    if (typeof record.Tag !== "string") continue;
    const standing = typeof record.Standing === "number" ? record.Standing : 0;
    balances.set(record.Tag, standing);
  }
  return balances;
}

export function readCompletedQuests(inventory: RawInventoryData | null): Set<string> {
  const finished = new Set<string>();
  const rows = inventory?.QuestKeys;
  if (!Array.isArray(rows)) return finished;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as { ItemType?: unknown; Completed?: unknown };
    if (record.Completed !== true || typeof record.ItemType !== "string") continue;
    finished.add(record.ItemType);
  }
  return finished;
}

/** The parts of each built modular item: a Zaw, an Amp, a MOA. */
function readAssemblies(inventory: Record<string, unknown>): string[][] {
  return Object.values(inventory)
    .filter(Array.isArray)
    .flat()
    .flatMap((entry: unknown) => {
      const parts = (entry as { ModularParts?: unknown } | null)?.ModularParts;
      return Array.isArray(parts) ? [parts.filter((part) => typeof part === "string")] : [];
    });
}

/** A part built into a modular item is a copy the player holds. */
function withInstalledParts(
  owned: Map<string, number>,
  assemblies: readonly string[][],
): Map<string, number> {
  for (const part of assemblies.flat()) owned.set(part, (owned.get(part) ?? 0) + 1);
  return owned;
}

/** Everything resolution reads off the player, indexed once per plan. */
export interface PlayerState {
  owned: Map<string, number>;
  assemblies: string[][];
  names: Map<string, string[]>;
  relics: Map<string, number>;
  pending: Map<string, PendingBuild>;
  standing: Map<string, number> | null;
  standingCap: number;
  questsDone: Set<string>;
  /** Null when the payload carries no balance, which is unknown rather than broke. */
  credits: number | null;
}

/** All a quest answer reads, cheap enough to build once for a whole sweep. */
export type QuestState = Pick<PlayerState, "names" | "questsDone">;

export function readQuestState(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): QuestState {
  return { names: buildNameIndex(itemDb ?? {}), questsDone: readCompletedQuests(inventory) };
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
  const assemblies = readAssemblies(usable);
  return {
    owned: withInstalledParts(aggregateComponentOwnership(usable), assemblies),
    assemblies,
    names: buildNameIndex(db),
    relics: buildRelicIndex(inventory, db),
    pending: buildPendingIndex(inventory, db),
    standing: readStanding(inventory),
    standingCap: dailyStandingCap(inventory),
    questsDone: readCompletedQuests(inventory),
    credits: toFiniteNumber(inventory?.RegularCredits),
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
  const relic = state.relics.get(nameKey(label.replace(RELIC_SUFFIX, "")));
  if (relic !== undefined) return relic;

  const matches = itemsForLabel(state, label, itemName);
  if (!matches) return null;
  let total = 0;
  for (const uniqueName of matches) total += state.owned.get(uniqueName) ?? 0;
  return total;
}

/** The blueprint a material is crafted from, by its exact "<label> Blueprint" name:
 *  how many the player holds, and whether DE marks it reusable. Null when the item
 *  database names no such blueprint. */
export function blueprintFor(
  state: PlayerState,
  itemDb: Record<string, ItemDbEntry>,
  label: string,
): { held: number; reusable: boolean } | null {
  const matches = state.names.get(nameKey(`${label} blueprint`));
  if (!matches) return null;
  return {
    held: matches.reduce((sum, uniqueName) => sum + (state.owned.get(uniqueName) ?? 0), 0),
    reusable: matches.some((uniqueName) => itemDb[uniqueName]?.reusableBlueprint === true),
  };
}

/** Built modular items holding any part the labels name. */
export function assembledFrom(
  state: PlayerState,
  labels: readonly string[],
  itemName: string,
): number {
  const parts = new Set(labels.flatMap((label) => itemsForLabel(state, label, itemName) ?? []));
  return state.assemblies.filter((assembly) => assembly.some((part) => parts.has(part))).length;
}

/** The item database rows a label names, or null when it names none. */
export function itemsForLabel(
  state: PlayerState,
  label: string,
  itemName: string,
): readonly string[] | null {
  for (const candidate of candidates(label, itemName)) {
    const matches = state.names.get(nameKey(candidate));
    if (matches) return matches;
  }
  return null;
}

function questNames(label: string): string[] {
  const bare = label.replace(QUEST_SUFFIX, "").trim();
  return [label, bare, bare.replace(LEADING_THE, "").trim(), `The ${bare}`];
}

function questPartDone(state: QuestState, label: string): boolean | null {
  for (const name of questNames(label)) {
    const matches = state.names.get(nameKey(name));
    if (!matches) continue;
    const keychains = matches.filter((uniqueName) => QUEST_KEYCHAIN.test(uniqueName));
    if (keychains.length === 0) continue;
    return keychains.every((uniqueName) => state.questsDone.has(uniqueName));
  }
  return null;
}

/** Whether every quest a gate row names is finished, or null when the label names
 *  no quest at all. Null is the only answer that leaves the row to the player. */
export function questDoneForLabel(state: QuestState, label: string): boolean | null {
  let answer: boolean | null = null;
  for (const part of label.replace(QUEST_CHAIN_PREFIX, "").split(QUEST_CHAIN_SEPARATOR)) {
    const done = questPartDone(state, part.trim());
    if (done === null) continue;
    answer = (answer ?? true) && done;
  }
  return answer;
}

export function pendingBuildFor(
  state: PlayerState,
  label: string,
  itemName: string,
): PendingBuild | null {
  for (const candidate of candidates(label, itemName)) {
    const match = state.pending.get(nameKey(candidate));
    if (match) return match;
  }
  return null;
}

/** Standing the rank table has no row for: Simaris has no ranks, and "Syndicate
 *  Standing" is paid by whichever faction syndicate the player stands best with. */
const UNRANKED_TAGS: Record<string, readonly string[]> = {
  simaris: ["LibrarySyndicate"],
  "cephalon simaris": ["LibrarySyndicate"],
  ostrons: ["CetusSyndicate"],
  syndicate: SYNDICATE_RANKS.filter((meta) => meta.kind === "normal").map((meta) => meta.tag),
};

/** "Solaris United standing" -> the affiliation tags that can pay it. */
function standingTags(currency: string): readonly string[] {
  if (!STANDING_SUFFIX.test(currency)) return [];
  const name = currency.replace(STANDING_SUFFIX, "").trim();
  const ranked = rankSyndicate(name);
  return ranked ? [ranked.tag] : (UNRANKED_TAGS[name.toLowerCase()] ?? []);
}

/** Null for a currency that is not standing, or a payload with no affiliations. */
export function standingBalance(state: PlayerState, currency: string): number | null {
  const tags = standingTags(currency);
  const standing = state.standing;
  if (tags.length === 0 || !standing) return null;
  return Math.max(...tags.map((tag) => standing.get(tag) ?? 0));
}

/** What the player holds of anything a plan counts: standing, credits or items.
 *  Null when nothing the app reads answers the label. */
export function balanceFor(state: PlayerState, label: string, itemName: string): number | null {
  if (CREDITS.test(label.trim())) return state.credits;
  return standingBalance(state, label) ?? ownedForLabel(state, label, itemName);
}

/** A currency balance: unknown, not zero, until an inventory has been read. */
export function readBalance(
  state: PlayerState,
  inventory: RawInventoryData | null,
  currency: string,
  itemName: string,
): number | null {
  return inventory ? balanceFor(state, currency, itemName) : null;
}

/** The one read of what a plan names, through the resource store's spelling. */
export function readLabel(
  state: PlayerState,
  label: string,
  itemName: string,
  lookup: ResourceLookup,
): number | null {
  return balanceFor(state, lookup(label)?.name ?? label, itemName);
}
