import { NO_GAIN, PARTIAL_GAIN } from "./gain.js";
import { ownedValenceByName, type OwnedValence } from "./ownedValence.js";
import { itemTiers } from "./acquisition/tiers.js";
import { vendorOffers } from "./vendorOffers.js";
import {
  codaItemsForBatch,
  loadAdversaryVendors,
  type AdversaryVendorItem,
  type AdversaryVendorsDoc,
} from "../world/adversaryVendors.js";
import { codaBatchAt } from "../../../config/shared/vendorRotation.js";
import type { ItemDbEntry, RawInventoryData } from "../../types/inventory.js";

/** Adversary rolls run 25-60. Valence Fusion lifts the better of two copies by
 *  1.1 and rounds anything from 58 up to the 60 cap, so 52.8 is the lowest roll
 *  a single further purchase can finish. */
export const VALENCE_CAP = 60;
export const ONE_FUSION_FROM_CAP = 52.8;
/** From here up, one fusion lands on the cap, so the weapon is done. */
export const VALENCE_FINISHED = 58;
const FUSION_MULTIPLIER = 1.1;

/** What buying this offer would do for the player, and nothing about how much
 *  they want the weapon. */
export type ValenceVerdict =
  /** Already at or over the fusion threshold: no offer can improve it. */
  | "done"
  /** Over the threshold but under the cap, so any second copy finishes it. */
  | "secondCopy"
  /** A copy is owned under the threshold and this offer is over it: buying
   *  it caps the weapon outright. */
  | "caps"
  /** None owned, and the offer is over the threshold, so one more will cap. */
  | "ready"
  /** Under the threshold either way. Still a real suggestion, because any
   *  second copy of a weapon the player owns fuses upward. */
  | "short";

const VERDICT_GAIN: Record<ValenceVerdict, number> = {
  done: NO_GAIN,
  secondCopy: PARTIAL_GAIN,
  caps: 1,
  ready: 0.8,
  short: 0.1,
};

/** What the weapon reads after buying this offer. A weapon the player does not
 *  own yet simply arrives at the offered percentage; one they do own fuses. */
export function valenceAfterPurchase(owned: number | null, offered: number): number {
  if (owned === null) return offered;
  const fused = Math.max(owned, offered) * FUSION_MULTIPLIER;
  if (fused >= VALENCE_FINISHED) return VALENCE_CAP;
  return Math.round(Math.min(fused, VALENCE_CAP) * 10) / 10;
}

export function valenceVerdict(owned: number | null, offered: number): ValenceVerdict {
  if (owned !== null && owned >= VALENCE_FINISHED) return "done";
  if (owned !== null && owned >= ONE_FUSION_FROM_CAP) return "secondCopy";
  if (offered < ONE_FUSION_FROM_CAP) return "short";
  return owned === null ? "ready" : "caps";
}

/**
 * Whether buying this offer still advances the player. Currency is farmed, so
 * the only purchase worth making is one that puts the cap in reach.
 */
export function valenceGain(owned: number | null, offered: number): number {
  return VERDICT_GAIN[valenceVerdict(owned, offered)];
}

/** One weapon on a rotation's table, against what the player already holds. */
export interface ValenceOffer extends AdversaryVendorItem {
  uniqueName?: string | undefined;
  /** Active game language, absent when it matches `name`. */
  displayName?: string | undefined;
  /** How good the weapon itself is; the only letter the card draws. */
  tier: string | null;
  /** The player's best copy, or null when they own none. */
  owned: number | null;
  /** What a purchase would leave the weapon at. */
  result: number;
  verdict: ValenceVerdict;
  gain: number;
}

function offerRow(item: AdversaryVendorItem, held: OwnedValence | undefined): ValenceOffer {
  const owned = held?.percent ?? null;
  const verdict = valenceVerdict(owned, item.bonus);
  return {
    ...item,
    tier: itemTiers(item.name),
    owned,
    result: valenceAfterPurchase(owned, item.bonus),
    verdict,
    gain: valenceGain(owned, item.bonus),
  };
}

/** The rows the vendor is holding this rotation, most advancing first. Empty
 *  means the wiki table named none of them, which is unknown rather than a low
 *  roll. Weapons are matched to the inventory by name, since that is all the
 *  wiki tables carry. */
export function valenceOffers(
  doc: AdversaryVendorsDoc | null,
  taskId: string,
  nowMs: number,
  owned: Map<string, OwnedValence> = new Map(),
): ValenceOffer[] {
  if (!doc) return [];
  let items: AdversaryVendorItem[] = [];
  if (taskId === "codaWeapons") items = codaItemsForBatch(doc, codaBatchAt(nowMs));
  else if (taskId === "tenetMelee") items = doc.tenet;
  const curated = vendorOffers(taskId);
  return items
    .map((item) => {
      const key = item.name.toLowerCase();
      const held = owned.get(key);
      const named = curated.find((offer) => offer.name.toLowerCase() === key);
      const uniqueName = held?.uniqueName ?? named?.uniqueName;
      return {
        ...offerRow(item, held),
        ...(uniqueName ? { uniqueName } : {}),
        ...(held?.displayName ? { displayName: held.displayName } : {}),
      };
    })
    .sort((a, b) => b.gain - a.gain || b.bonus - a.bonus || a.name.localeCompare(b.name));
}

/** The rows read against the player's own weapons. */
export function valenceOffersFor(
  doc: AdversaryVendorsDoc | null,
  taskId: string,
  nowMs: number,
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): ValenceOffer[] {
  return valenceOffers(doc, taskId, nowMs, ownedValenceByName(inventory, itemDb));
}

/** The offer worth buying, or null when nothing on the table advances the
 *  player. Picked by gain, never by the highest percentage. */
export function bestValenceOffer(offers: readonly ValenceOffer[]): ValenceOffer | null {
  return offers.find((offer) => offer.gain > NO_GAIN) ?? null;
}

// `SuggestionDetails` carries no field for structured rows, so the provider
// parks what it computed here and the card reads it back by suggestion id.
const cardRows = new Map<string, ValenceOffer[]>();

export function setValenceRows(id: string, offers: readonly ValenceOffer[]): void {
  if (offers.length === 0) cardRows.delete(id);
  else cardRows.set(id, [...offers]);
}

/** Empty for any suggestion that is not an adversary vendor. */
export function valenceRowsFor(id: string): ValenceOffer[] {
  return cardRows.get(id) ?? [];
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
  cardRows.clear();
}
