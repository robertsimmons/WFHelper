import { componentUniqueNameAliases } from "../../config/shared/componentNames.js";
import { aggregateComponentOwnership } from "../../config/shared/componentOwnership.js";
import { pendingRecipeCounts, withoutFoundryPending } from "../../config/shared/foundryPending.js";
import { buildClaimResolver, type RecipeClaim } from "./recipeClaims.js";
import type { ItemDbEntry, MasteryData, MasteryStatus } from "../types/inventory.js";

export interface SellVerdict {
  /** Copies of this spelling held back for gear still owed mastery. */
  reserved: number;
  sellable: number;
  claims: RecipeClaim[];
}

interface SellPlanOptions {
  /** Keep a copy of gear another recipe consumes, so both variants survive. */
  keepVariants?: boolean;
}

/** The one answer to "which copies are safe to sell", read by the Inventory grid
 *  and by bulk sell. A copy is needed while it still has to go into a build of
 *  something owed mastery; built and foundry copies of gear are in hand, a
 *  mastered-then-sold item is not. */
export interface SellPlan {
  statusOf(uniqueName?: string, name?: string): MasteryStatus | undefined;
  /** The item key a row stands for: its own key when the db knows any spelling
   *  of it, otherwise whatever the display name resolves to. */
  resolveKey(internalName?: string, name?: string): string | null;
  isGear(uniqueName: string): boolean;
  /** The gear a part belongs to, through whichever spelling the db describes. */
  parentOf(uniqueName: string): string | null;
  /** Null for rows that are neither a part, a blueprint nor a recipe ingredient. */
  verdict(uniqueName: string, owned: number): SellVerdict | null;
}

const RECIPE_PATH = /\/Types\/Recipes\//i;

function spellingsOf(uniqueName: string): string[] {
  return [
    ...new Set([...componentUniqueNameAliases(uniqueName), uniqueName.replace(/Blueprint$/i, "")]),
  ];
}

function recipeIngredients(itemDb: Record<string, ItemDbEntry>): Set<string> {
  const ingredients = new Set<string>();
  for (const entry of Object.values(itemDb)) {
    for (const component of Array.isArray(entry?.components) ? entry.components : []) {
      if (component?.uniqueName) ingredients.add(component.uniqueName);
    }
  }
  return ingredients;
}

export function buildSellPlan(
  itemDb: Record<string, ItemDbEntry>,
  mastery: MasteryData | null,
  inventoryData?: unknown,
  options: SellPlanOptions = {},
): SellPlan | null {
  const items = mastery?.items ?? [];
  if (items.length === 0) return null;

  const statusByUnique = new Map<string, MasteryStatus>();
  const statusByName = new Map<string, MasteryStatus>();
  for (const item of items) {
    if (!item.status) continue;
    const uniqueName = item.uniqueName || item.internalName;
    if (uniqueName) statusByUnique.set(uniqueName, item.status);
    statusByName.set(item.name.toLowerCase(), item.status);
  }
  const statusOf = (uniqueName?: string, name?: string): MasteryStatus | undefined =>
    (uniqueName ? statusByUnique.get(uniqueName) : undefined) ??
    (name ? statusByName.get(name.toLowerCase()) : undefined);
  const statusFor = (uniqueName: string) => statusOf(uniqueName, itemDb[uniqueName]?.name);

  const nameIndex = new Map<string, string>();
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    const key = entry.name?.toLowerCase();
    if (key && !nameIndex.has(key)) nameIndex.set(key, uniqueName);
  }

  // A part held as an unbuilt blueprint and as a built component is one pile,
  // keyed by the spelling the recipe lists.
  const ingredients = recipeIngredients(itemDb);
  const pileKeyOf = (uniqueName: string): string | null => {
    if (ingredients.has(uniqueName)) return uniqueName;
    return spellingsOf(uniqueName).find((spelling) => ingredients.has(spelling)) ?? null;
  };

  const inventory = (inventoryData ?? {}) as Record<string, unknown>;
  const usable = withoutFoundryPending(
    inventory,
    (uniqueName) => itemDb[uniqueName]?.reusableBlueprint === true,
  );
  const owned = aggregateComponentOwnership(usable);
  const members = new Map<string, string[]>();
  for (const uniqueName of owned.keys()) {
    const pile = pileKeyOf(uniqueName) ?? uniqueName;
    const list = members.get(pile);
    if (list) list.push(uniqueName);
    else members.set(pile, [uniqueName]);
  }
  // The built spelling is the copy kept, so it heads the pile.
  for (const [pile, list] of members) {
    list.sort((a, b) => (a === pile ? -1 : b === pile ? 1 : a.localeCompare(b)));
  }

  // What the foundry is turning out is in hand already.
  const building = new Map<string, number>();
  for (const [blueprint, count] of pendingRecipeCounts(inventory.PendingRecipes)) {
    const product = itemDb[blueprint]?.buildsProduct;
    if (!product) continue;
    const pile = pileKeyOf(product) ?? product;
    building.set(pile, (building.get(pile) ?? 0) + count);
  }

  const heldInPile = (pile: string): number =>
    (members.get(pile) ?? []).reduce((sum, member) => sum + (owned.get(member) ?? 0), 0);
  const held = (uniqueName: string): number => {
    const pile = pileKeyOf(uniqueName) ?? uniqueName;
    return heldInPile(pile) + (building.get(pile) ?? 0);
  };

  const keepVariants = options.keepVariants === true;
  const claimResolver = buildClaimResolver(itemDb, statusFor, held, { keepVariants });

  const isGear = (uniqueName: string): boolean =>
    statusFor(uniqueName) !== undefined && itemDb[uniqueName]?.isBuildComponent !== true;

  /** Copies of the pile's other spellings that are kept before this one. */
  const keptAhead = (pile: string, uniqueName: string): number => {
    if (uniqueName === pile) return 0;
    let ahead = 0;
    for (const member of members.get(pile) ?? []) {
      if (member === uniqueName) break;
      ahead += owned.get(member) ?? 0;
    }
    return ahead;
  };

  const verdict = (uniqueName: string, count: number): SellVerdict | null => {
    const copies = Math.max(0, Math.floor(count));
    const pile = pileKeyOf(uniqueName);
    if (!pile) {
      if (isGear(uniqueName)) return null;
      const part = RECIPE_PATH.test(uniqueName) || itemDb[uniqueName]?.isBuildComponent === true;
      return part ? { reserved: 0, sellable: copies, claims: [] } : null;
    }

    const { claims } = claimResolver(pile, copies);
    const demand = claims.reduce((sum, claim) => sum + claim.count, 0);
    let needed: number;
    if (isGear(pile)) {
      const forConsumers = keepVariants && demand > 0 ? demand + 1 : demand;
      needed = Math.max(forConsumers, statusFor(pile) === "mastered" ? 0 : 1);
    } else {
      needed = demand - (building.get(pile) ?? 0) - keptAhead(pile, uniqueName);
    }
    const reserved = Math.min(copies, Math.max(0, needed));
    return { reserved, sellable: copies - reserved, claims };
  };

  const resolveKey = (internalName?: string, name?: string): string | null => {
    if (internalName && spellingsOf(internalName).some((spelling) => itemDb[spelling])) {
      return internalName;
    }
    return (name ? nameIndex.get(name.toLowerCase()) : undefined) ?? null;
  };

  const parentOf = (uniqueName: string): string | null => {
    const pile = pileKeyOf(uniqueName);
    const spellings = pile ? [...spellingsOf(uniqueName), pile] : spellingsOf(uniqueName);
    for (const spelling of spellings) {
      const parent = itemDb[spelling]?.componentOf;
      if (parent) return parent;
    }
    return null;
  };

  return { statusOf, resolveKey, isGear, parentOf, verdict };
}
