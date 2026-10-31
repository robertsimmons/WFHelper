import { resolveAcquisition } from "../index.js";
import { shopFor, shopUsers } from "../shops/data.js";
import { pickShop, type ResolvedShop } from "../shops/picker.js";
import { COSMETIC, type ShopWare } from "../shops/schema.js";
import { balanceFor, itemsForLabel, type PlayerState } from "./state.js";
import type { AuthoredPlan } from "./schema.js";
import type { PlanContext, ResolvedGroup } from "./types.js";

const BLUEPRINT = /\s+blueprint$/i;

/** "Sirius & Orion Neuroptics Blueprint" and the plan's "Neuroptics Blueprint" row
 *  name the same thing. */
function sameWare(label: string, ware: string, item: string): boolean {
  const bare = (text: string): string => {
    const lower = text.trim().toLowerCase().replace(BLUEPRINT, "");
    const prefix = `${item.toLowerCase()} `;
    return lower.startsWith(prefix)
      ? lower.slice(prefix.length)
      : lower === item.toLowerCase()
        ? ""
        : lower;
  };
  return bare(label) === bare(ware);
}

/** What the plan's own rows say the player holds of a ware, and what a quest the
 *  plan still walks hands over. Build rows name the product, not the blueprint. */
function heldByRows(groups: readonly ResolvedGroup[], ware: ShopWare) {
  let owned = 0;
  let quest = 0;
  for (const group of groups) {
    if (group.type === "foundry" || group.type === "craft") continue;
    for (const row of group.rows) {
      if (!sameWare(row.label, ware.name, ware.item)) continue;
      owned = Math.max(
        owned,
        row.qty ? Math.min(row.qty.owned, row.qty.required) : row.done ? 1 : 0,
      );
      if (group.quest && group.skip === null && !row.done) quest = 1;
    }
  }
  return { owned, quest };
}

/** A ware read off the inventory: the blueprint, or the part it built. */
function heldInInventory(state: PlayerState, context: PlanContext, ware: ShopWare): number {
  const matches = itemsForLabel(state, ware.name, ware.item) ?? [];
  return matches.reduce((sum, uniqueName) => {
    const product = context.itemDb[uniqueName]?.buildsProduct;
    const built = product ? (state.owned.get(product) ?? 0) : 0;
    return sum + (state.owned.get(uniqueName) ?? 0) + built;
  }, 0);
}

/** Units of a ware one build of `item` takes, read off the item's recipe; none when
 *  the item database holds no recipe for it or no row for the ware. */
function recipeUses(
  state: PlayerState,
  context: PlanContext,
  ware: ShopWare,
  item: string,
): number {
  const db = context.itemDb;
  const products = (itemsForLabel(state, item, item) ?? []).filter((name) => db[name]?.recipe);
  const recipe = products.map((name) => db[name]?.recipe).find(Boolean);
  const wares = itemsForLabel(state, ware.name, ware.item) ?? [];
  if (!recipe || wares.length === 0) return 0;
  const makes = new Set(wares.flatMap((name) => [name, db[name]?.buildsProduct ?? name]));
  if (products.some((name) => makes.has(name))) return 1;
  return recipe.ingredients
    .filter((ingredient) => makes.has(ingredient.uniqueName))
    .reduce((sum, ingredient) => sum + ingredient.count, 0);
}

/** Builds each item still owes, by the acquisition sweep's own rule, so every
 *  plan sharing the shop sizes it alike: none once it owes neither mastery nor
 *  a subsume. */
function buildsOwed(context: PlanContext, items: readonly string[]): (item: string) => number {
  const targets = resolveAcquisition({
    itemDb: context.itemDb,
    inventory: context.inventory,
    mastery: context.mastery,
    only: items,
  });
  const owed = new Map(
    targets
      .filter((target) => target.needs.some((need) => need === "mastery" || need === "subsume"))
      .map((target) => [target.name, target.parts.copies]),
  );
  return (item) => owed.get(item) ?? 0;
}

export function resolveShop(
  plan: AuthoredPlan,
  groups: readonly ResolvedGroup[],
  state: PlayerState,
  context: PlanContext,
  sizing: {
    crafting: (currency: string) => number;
    /** What the card counts the player has of a ware it sizes; null for any other. */
    got: (label: string) => number | null;
  },
): ResolvedShop | null {
  const { crafting, got } = sizing;
  const key = plan.shop;
  const shop = key ? shopFor(key) : null;
  if (!key || !shop) return null;
  const items = [...new Set(shop.wares.map((ware) => ware.item))].filter(
    (item) => item !== COSMETIC,
  );
  const builds = buildsOwed(context, items);
  const uses = (ware: ShopWare, item: string): number => recipeUses(state, context, ware, item);
  const own = (ware: ShopWare): boolean => uses(ware, plan.name) > 0;
  return pickShop({
    key,
    shop,
    own,
    crafting,
    wanted: (ware) => items.reduce((sum, item) => sum + uses(ware, item) * builds(item), 0),
    held: (ware) => {
      const rows = own(ware) ? heldByRows(groups, ware) : { owned: 0, quest: 0 };
      return {
        owned: Math.max(rows.owned, got(ware.name) ?? heldInInventory(state, context, ware)),
        quest: rows.quest,
      };
    },
    balance: (currency) => (context.inventory ? balanceFor(state, currency, currency) : null),
    flipped: context.shopPicks?.[key] ?? [],
    also: shopUsers(key).filter((name) => name !== plan.name),
  });
}
