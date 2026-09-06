import { toMarketSlug } from "../../marketNaming.js";
import { getCachedPriceState } from "../../wfm/priceCache.js";
import { rendererPriceCacheKey } from "../../../../config/shared/wfmCacheKeys.js";
import type { PlatPriceLookup } from "./types.js";

/** Reads only what the price cache already holds - the resolver never fetches. */
export function cachedPlatPrices(): PlatPriceLookup {
  return (name) => {
    const slug = toMarketSlug(name);
    if (!slug) return null;
    const entry = getCachedPriceState(rendererPriceCacheKey(slug, null));
    return entry?.status === "ok" ? entry.median : null;
  };
}
