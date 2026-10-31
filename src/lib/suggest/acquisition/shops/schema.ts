import type { PlanRank } from "../plan/schema.js";

/** A ware no item is built from. */
export const COSMETIC = "cosmetic";

interface ShopCurrency {
  /** The resource store's spelling. */
  name: string;
  /** What one run of the activity that pays it yields, when the data knows. */
  perRun?: number;
}

export interface ShopWare {
  name: string;
  /** The plan name of the item it is listed under, or `cosmetic`. How many units
   *  a player wants comes from the recipes of the shop's items. */
  item: string;
  /** Per currency. In an `either` shop a ware listing several takes any one of
   *  them unless `all` is set; otherwise it takes all of them. */
  price: Record<string, number>;
  /** Pays every currency it lists at once, even in an `either` shop. */
  all?: boolean;
  rank?: PlanRank;
}

/** A vendor several plans buy from, one file per vendor. `together` marks
 *  currencies one run pays all at once. */
export interface AuthoredShop {
  vendor: string;
  place: string;
  currencies: ShopCurrency[];
  either?: boolean;
  together?: boolean;
  notes?: string[];
  wares: ShopWare[];
}
