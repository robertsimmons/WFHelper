import { authoredPlans } from "../plan/data.js";
import type { AuthoredShop } from "./schema.js";

const loaded = import.meta.glob("../../../../data/suggest/shops/*.json", { eager: true });

const SHOPS = new Map<string, AuthoredShop>(
  Object.entries(loaded)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, module]) => {
      const key = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
      return [key, ((module as { default?: unknown }).default ?? module) as AuthoredShop];
    }),
);

/** Every shop that ships with the app, keyed by file name, for the validator. */
export function authoredShops(): Map<string, AuthoredShop> {
  return new Map(SHOPS);
}

export function shopFor(key: string): AuthoredShop | null {
  return SHOPS.get(key) ?? null;
}

/** The names of the plans that buy from the shop. */
export function shopUsers(key: string): string[] {
  return authoredPlans()
    .filter((plan) => plan.shop === key)
    .map((plan) => plan.name);
}
