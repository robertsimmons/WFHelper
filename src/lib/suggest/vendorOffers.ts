import data from "../../data/suggest/vendorOffers.json";

/** One thing a vendor could put on the table, ordered most valuable first. The
 *  table covers only vendors world state carries no manifest for. */
export interface VendorOffer {
  name: string;
  uniqueName?: string | undefined;
}

const OFFERS = data as Record<string, VendorOffer[]>;

/** Empty for a vendor the table does not name, including everyone whose real
 *  stock the world state already carries. */
export function vendorOffers(taskId: string): VendorOffer[] {
  return OFFERS[taskId] ?? [];
}
