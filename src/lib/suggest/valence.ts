import {
  codaItemsForBatch,
  loadAdversaryVendors,
  type AdversaryVendorItem,
  type AdversaryVendorsDoc,
} from "../world/adversaryVendors.js";
import { codaBatchAt } from "../../../config/shared/vendorRotation.js";

/** Adversary rolls run 25-60. Valence Fusion lifts the better of two copies by
 *  1.1 and rounds anything from 58 up to the 60 cap, so a roll of 52.8 is one
 *  further purchase from perfect and 48.0 is two. */
export const VALENCE_CAP = 60;
export const ONE_FUSION_FROM_CAP = 52.8;
export const TWO_FUSIONS_FROM_CAP = 48;

export type ValenceTier = "capped" | "oneAway" | "twoAway" | "ordinary";

/** Floor the tier puts on the vendor's own value signal; ordinary leaves it. */
const TIER_VALUE: Record<ValenceTier, number> = {
  capped: 1,
  oneAway: 0.8,
  twoAway: 0.6,
  ordinary: 0,
};

export interface ValenceOffer extends AdversaryVendorItem {
  tier: ValenceTier;
}

export function valenceTier(bonus: number): ValenceTier {
  if (bonus >= VALENCE_CAP) return "capped";
  if (bonus >= ONE_FUSION_FROM_CAP) return "oneAway";
  if (bonus >= TWO_FUSIONS_FROM_CAP) return "twoAway";
  return "ordinary";
}

export function valenceValueFloor(tier: ValenceTier): number {
  return TIER_VALUE[tier];
}

/** The rows the vendor is holding this rotation, best roll first. Empty means
 *  the wiki table named none of them, which is unknown rather than a low roll. */
export function valenceOffers(
  doc: AdversaryVendorsDoc | null,
  taskId: string,
  nowMs: number,
): ValenceOffer[] {
  if (!doc) return [];
  let items: AdversaryVendorItem[] = [];
  if (taskId === "codaWeapons") items = codaItemsForBatch(doc, codaBatchAt(nowMs));
  else if (taskId === "tenetMelee") items = doc.tenet;
  return items
    .map((item) => ({ ...item, tier: valenceTier(item.bonus) }))
    .sort((a, b) => b.bonus - a.bonus || a.name.localeCompare(b.name));
}

let snapshot: AdversaryVendorsDoc | null = null;
let started = false;

/** The provider collects synchronously, so the first pass runs before the doc
 *  has landed and the feed's own clock picks it up on a later one. */
export function valenceDoc(): AdversaryVendorsDoc | null {
  if (!started) {
    started = true;
    void loadAdversaryVendors().then(
      (doc) => {
        snapshot = doc;
      },
      () => {
        snapshot = null;
      },
    );
  }
  return snapshot;
}

export function setValenceDocForTest(doc: AdversaryVendorsDoc | null): void {
  snapshot = doc;
  started = true;
}

export function resetValenceDocForTest(): void {
  snapshot = null;
  started = false;
}
