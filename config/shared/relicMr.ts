import { componentUniqueNameAliases, ownedComponentCount } from "./componentNames";
import type { MasteryStatus } from "./masteryTypes";
import { relicRewardRarity, type RelicRefinement } from "./relicRarity";

export type RelicRarity = "common" | "uncommon" | "rare";
export type RelicRewardStatus = "needed" | "owned" | "mastered";

/** The item-database fields the read joins on. Both the renderer's and main's
 *  item entries satisfy it. */
export interface RelicMrItem {
  name?: string | undefined;
  displayName?: string | undefined;
  masterable?: boolean | undefined;
  isBuildComponent?: boolean | undefined;
  /** uniqueName of the item this part builds. */
  componentOf?: string | undefined;
  components?: readonly {
    name?: string | undefined;
    uniqueName?: string | undefined;
    itemCount?: number | undefined;
  }[];
}

interface RelicMrReward {
  name: string;
  /** Item-database key the caller resolved the reward to. */
  uniqueName?: string | null | undefined;
}

interface RelicMrInput {
  /** One relic's rewards, any refinement's table: they differ only in chance. */
  rewards: readonly RelicMrReward[];
  itemDb: Readonly<Record<string, RelicMrItem>>;
  /** `aggregateComponentOwnership` over the inventory: parts, blueprints, built gear. */
  ownership: Map<string, number>;
  /** `masteredKeys` over the mastery roster. */
  mastered: ReadonlySet<string>;
  /** `pendingBuildCounts`; a build in the foundry counts as held. */
  pending?: Map<string, number> | undefined;
}

export interface RelicRewardMr {
  name: string;
  status: RelicRewardStatus | null;
  /** Copies of the part held, or of the built item where only that is held.
   *  Null where the item database cannot place the reward. */
  ownedCount: number | null;
  /** Display name of the item the part builds; null for anything not gear. */
  builds: string | null;
  /** Needed, and the only part of `builds` still missing. */
  finishes: boolean;
}

export interface RelicMr {
  /** In input order. */
  rewards: RelicRewardMr[];
  needed: number;
  /** Display names of the items a needed part would complete. */
  finishes: string[];
  value: number;
}

const NEEDED_WEIGHT = 1;
const FINISH_BONUS = 1;

/** Keys `relicMr` reads mastery by: uniqueNames, and lowercased English names for
 *  rows that carry none. Only a finished item lands; progress is not mastered. */
export function masteredKeys(
  items: readonly {
    uniqueName?: string | null | undefined;
    name?: string | null | undefined;
    status?: MasteryStatus | null | undefined;
  }[],
): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    if (item.status !== "mastered") continue;
    if (item.uniqueName) keys.add(item.uniqueName);
    if (item.name) keys.add(item.name.toLowerCase());
  }
  return keys;
}

function isMastered(
  mastered: ReadonlySet<string>,
  uniqueName: string,
  name: string | undefined,
): boolean {
  return mastered.has(uniqueName) || Boolean(name && mastered.has(name.toLowerCase()));
}

/** The relic table spells a part as its blueprint or as the built component; the
 *  item database keys whichever one DE exported. */
function resolveEntry(
  itemDb: Readonly<Record<string, RelicMrItem>>,
  uniqueName: string,
): { uniqueName: string; entry: RelicMrItem } | null {
  for (const candidate of [
    ...componentUniqueNameAliases(uniqueName),
    uniqueName.replace(/Blueprint$/i, ""),
  ]) {
    const entry = itemDb[candidate];
    if (entry) return { uniqueName: candidate, entry };
  }
  return null;
}

function sameComponent(a: string, b: string): boolean {
  return componentUniqueNameAliases(a).includes(b) || componentUniqueNameAliases(b).includes(a);
}

interface ResolvedPart {
  uniqueName: string;
  /** The masterable item the part builds, where the database places one. */
  parentKey: string | undefined;
}

function lastSegment(uniqueName: string): string {
  return uniqueName.slice(uniqueName.lastIndexOf("/") + 1).trim();
}

/** The component that is the item's own blueprint rather than one of its parts. */
function mainBlueprint(parentKey: string, parent: RelicMrItem): string | null {
  const components = parent.components ?? [];
  const named = components.find((component) => component.name === "Blueprint");
  if (named?.uniqueName) return named.uniqueName;
  const base = lastSegment(parentKey);
  const matched = components.find(
    (component) =>
      component.uniqueName &&
      /Blueprint$/i.test(component.uniqueName) &&
      lastSegment(component.uniqueName.replace(/Blueprint$/i, "")) === base,
  );
  return matched?.uniqueName ?? null;
}

/** A main blueprint joins by name to the item it builds ("Wukong Prime
 *  Blueprint" to Wukong Prime); the drop is still that item's blueprint. */
function resolvePart(
  itemDb: Readonly<Record<string, RelicMrItem>>,
  reward: RelicMrReward,
): ResolvedPart | null {
  if (!reward.uniqueName) return null;
  const resolved = resolveEntry(itemDb, reward.uniqueName);
  if (!resolved) return null;
  const { uniqueName, entry } = resolved;
  if (entry.isBuildComponent) return { uniqueName, parentKey: entry.componentOf };
  if (entry.masterable === true && /Blueprint$/i.test(reward.name.trim())) {
    const blueprint = mainBlueprint(uniqueName, entry);
    if (blueprint) return { uniqueName: blueprint, parentKey: uniqueName };
  }
  return { uniqueName, parentKey: undefined };
}

interface SetPart {
  uniqueName: string;
  required: number;
}

/** What the parent is built from, less its resources: build components, plus
 *  built gear a recipe consumes (Aklex Prime eats two Lex Primes). */
function setParts(parent: RelicMrItem, itemDb: Readonly<Record<string, RelicMrItem>>): SetPart[] {
  const parts: SetPart[] = [];
  for (const component of parent.components ?? []) {
    if (!component.uniqueName) continue;
    const entry = resolveEntry(itemDb, component.uniqueName)?.entry;
    if (entry?.isBuildComponent !== true && entry?.masterable !== true) continue;
    parts.push({ uniqueName: component.uniqueName, required: component.itemCount || 1 });
  }
  return parts;
}

function readReward(reward: RelicMrReward, input: RelicMrInput): RelicRewardMr {
  const { itemDb, mastered } = input;
  const held = (uniqueName: string): number =>
    ownedComponentCount(uniqueName, input.ownership) +
    (input.pending ? ownedComponentCount(uniqueName, input.pending) : 0);
  const blank: RelicRewardMr = {
    name: reward.name,
    status: null,
    ownedCount: null,
    builds: null,
    finishes: false,
  };

  const resolved = resolvePart(itemDb, reward);
  if (!resolved) return blank;
  const partHeld = held(resolved.uniqueName);

  const { parentKey } = resolved;
  const parent = parentKey ? itemDb[parentKey] : undefined;
  if (!parentKey || parent?.masterable !== true) {
    // Forma and the like: nothing to master, only a stack to count.
    return { ...blank, status: partHeld > 0 ? "owned" : null, ownedCount: partHeld };
  }

  const builds = parent.displayName ?? parent.name ?? null;
  if (isMastered(mastered, parentKey, parent.name)) {
    return { ...blank, status: "mastered", ownedCount: partHeld, builds };
  }
  const builtHeld = held(parentKey);
  if (builtHeld > 0) {
    return { ...blank, status: "owned", ownedCount: partHeld > 0 ? partHeld : builtHeld, builds };
  }

  const parts = setParts(parent, itemDb);
  const own = parts.find((part) => sameComponent(part.uniqueName, resolved.uniqueName));
  if (partHeld >= (own?.required ?? 1)) {
    return { ...blank, status: "owned", ownedCount: partHeld, builds };
  }
  const finishes = parts.every((part) => part === own || held(part.uniqueName) >= part.required);
  return { ...blank, status: "needed", ownedCount: partHeld, builds, finishes };
}

/** Which of one relic's rewards the player still needs for mastery, and what
 *  the relic is worth on that goal: a point per needed part, and a point more
 *  for a part that completes its item. */
export function relicMr(input: RelicMrInput): RelicMr {
  const rewards = input.rewards.map((reward) => readReward(reward, input));
  const seen = new Set<string>();
  const finishes: string[] = [];
  let needed = 0;
  let value = 0;
  for (const reward of rewards) {
    if (reward.status !== "needed" || seen.has(reward.name)) continue;
    seen.add(reward.name);
    needed += 1;
    value += NEEDED_WEIGHT;
    if (!reward.finishes) continue;
    value += FINISH_BONUS;
    if (reward.builds && !finishes.includes(reward.builds)) finishes.push(reward.builds);
  }
  return { rewards, needed, finishes, value };
}

/** Rarity off the chance the refinement's own table gives the reward; the
 *  label the table ships is only the fallback. */
export function relicRarity(
  quality: RelicRefinement,
  reward: { chance: number; rarity?: string | null | undefined },
): RelicRarity | null {
  const label = relicRewardRarity(quality, reward.chance, reward.rarity ?? "").toLowerCase();
  return label === "common" || label === "uncommon" || label === "rare" ? label : null;
}

const RARITY_RANK: Record<RelicRarity, number> = { common: 0, uncommon: 1, rare: 2 };

/** Radiant pays a rare five times as often as Intact; an uncommon gains most of
 *  its lift by Flawless, so the last 50 traces are not spent on it. */
const MR_REFINEMENT: Record<RelicRarity, RelicRefinement> = {
  common: "intact",
  uncommon: "flawless",
  rare: "radiant",
};

const PRIME_RARE_DUCATS = 100;

export interface RelicAdviceReward {
  rarity: RelicRarity | null;
  platinum: number | null;
  ducats: number | null;
  status: RelicRewardStatus | null;
}

export interface RelicAdvice {
  /** Null when nothing in the relic is needed. */
  mr: RelicRefinement | null;
  platinum: RelicRefinement;
  ducats: RelicRefinement;
}

/** The refinement worth cracking per goal, off one row per distinct reward.
 *  MR goes by the rarest needed part. Platinum goes Radiant only when the rare
 *  is the single most valuable drop, and ducats only when the rare is a
 *  100-ducat part; otherwise Intact, since traces buy nothing a common needs. */
export function relicAdvice(rewards: readonly RelicAdviceReward[]): RelicAdvice {
  let rarest: RelicRarity | null = null;
  let rarePlat: number | null = null;
  let otherPlat = 0;
  let rareHundred = false;
  for (const reward of rewards) {
    if (reward.status === "needed") {
      const rarity = reward.rarity ?? "common";
      if (!rarest || RARITY_RANK[rarity] > RARITY_RANK[rarest]) rarest = rarity;
    }
    if (reward.rarity === "rare") {
      if (reward.platinum != null) rarePlat = Math.max(rarePlat ?? 0, reward.platinum);
      if (reward.ducats === PRIME_RARE_DUCATS) rareHundred = true;
    } else if (reward.platinum != null) {
      otherPlat = Math.max(otherPlat, reward.platinum);
    }
  }
  return {
    mr: rarest ? MR_REFINEMENT[rarest] : null,
    platinum: rarePlat != null && rarePlat > otherPlat ? "radiant" : "intact",
    ducats: rareHundred ? "radiant" : "intact",
  };
}
