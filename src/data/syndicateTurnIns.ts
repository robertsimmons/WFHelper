// Typed shim over the generated table (scripts/suggest/build-syndicate-turnins.mjs
// writes the JSON; source wiki.warframe.com syndicate and fish pages, CC BY-SA).
import data from "./syndicateTurnIns.json";

export interface SyndicateTurnInYield {
  itemType: string | null;
  name: string;
  count: number;
}

export interface SyndicateTurnIn {
  itemType: string | null;
  name: string;
  /** Standing per unit handed in. */
  standing: number;
  /** What cutting one unit up gives instead. */
  yields?: SyndicateTurnInYield[];
}

export interface ShopTrade {
  itemType: string;
  name: string;
  quantity: number;
  prices: { itemType: string; count: number }[];
}

export const SYNDICATE_TURN_INS = data.syndicates as Record<string, { turnIns: SyndicateTurnIn[] }>;

export const SHOP_TRADES = data.trades as ShopTrade[];
