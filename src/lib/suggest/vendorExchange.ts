import { ownedComponentCount } from "../../../config/shared/componentNames.js";
import data from "../../data/suggest/vendorExchange.json";
import { SYNDICATE_RANKS } from "../../data/syndicateRanks.js";
import { planSteps } from "../syndicates/rankup.js";
import { buildOwnership } from "./acquisition/parts.js";
import { resourceNeed, resourceWanters } from "./resourceNeed.js";
import type { AcquisitionTarget } from "./acquisition/types.js";
import type { ItemDbEntry, RawInventoryData } from "../../types/inventory.js";

export type ExchangeVendor = "yonta" | "marie";

interface ExchangePrice {
  uniqueName: string;
  name: string;
  min: number;
  max: number;
}

interface FixedPrice {
  uniqueName: string;
  name: string;
  count: number;
}

interface ExchangeOffer {
  uniqueName: string;
  name: string;
  quantity: number;
  /** A mod or arcane is wanted once; a resource for as long as anything asks for it. */
  kind: "resource" | "upgrade";
  prices: ExchangePrice[];
}

interface ExchangeArtifact {
  storeItem: string;
  uniqueName: string;
  name: string;
  prices: FixedPrice[];
}

interface ExchangeTable {
  yonta: {
    hours: number;
    offers: ExchangeOffer[];
    kuva: { quantity: number; price: FixedPrice } | null;
  };
  marie: { hours: number; offers: ExchangeOffer[]; artifacts: ExchangeArtifact[] };
}

const TABLE = data as unknown as ExchangeTable;

/** Each offer is priced in two of its bin's resources, drawn at random. */
const PRICES_PER_OFFER = 2;

const HOLDFASTS = "ZarimanSyndicate";

const HOUR_MS = 3_600_000;

const KUVA = "/Lotus/Types/Items/MiscItems/Kuva";

interface ExchangeWanter {
  name: string;
  count: number;
}

interface ExchangeCost extends ExchangePrice {
  spare: number;
  /** Spare covers the price at the top of its range. */
  covers: boolean;
}

export interface ExchangeOfferRow {
  uniqueName: string;
  name: string;
  quantity: number;
  kind: ExchangeOffer["kind"];
  held: number;
  needed: number;
  short: number;
  wantedBy: ExchangeWanter[];
  costs: ExchangeCost[];
  affordable: boolean;
}

interface ExchangeSpare {
  uniqueName: string;
  name: string;
  spare: number;
}

interface ExchangeKuva {
  quantity: number;
  price: FixedPrice;
  held: number;
  spare: number;
}

export interface ExchangeMat {
  uniqueName: string;
  name: string;
  held: number;
  needed: number;
  spare: number;
  wantedBy: ExchangeWanter[];
  /** One per offer, in the offers' order; null where that offer never charges it. */
  prices: ({ min: number; max: number; covers: boolean } | null)[];
  /** The Kuva trade's price in it, when that trade is open. */
  kuva: number | null;
}

export interface ExchangeDetails {
  vendor: ExchangeVendor;
  /** The rotation the offers were read against, which is what Done dismisses. */
  window: string;
  hours: number;
  /** Every offer that gives something still short, affordable first. */
  offers: ExchangeOfferRow[];
  /** Spare that pays for the affordable ones. */
  pay: ExchangeSpare[];
  kuva: ExchangeKuva | null;
  /** Every resource the offers and the Kuva trade price in, listed once. */
  mats: ExchangeMat[];
}

interface ExchangeLedger {
  needed: (uniqueName: string) => number;
  held: (uniqueName: string) => number;
  wantedBy: (uniqueName: string) => ExchangeWanter[];
}

/** The artifacts are in no item table, and which inventory slice holds a built
 *  one is unverified, so every slice is read under both spellings. */
function holdsAny(inventory: RawInventoryData | null, types: readonly string[]): boolean {
  for (const slice of Object.values((inventory ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(slice)) continue;
    for (const entry of slice) {
      const type = (entry as { ItemType?: unknown } | null)?.ItemType;
      if (typeof type === "string" && types.includes(type)) return true;
    }
  }
  return false;
}

function unownedArtifacts(inventory: RawInventoryData | null): ExchangeArtifact[] {
  return TABLE.marie.artifacts.filter(
    (artifact) => !holdsAny(inventory, [artifact.uniqueName, artifact.storeItem]),
  );
}

function rankUpNeed(inventory: RawInventoryData | null): Map<string, number> {
  const need = new Map<string, number>();
  const meta = SYNDICATE_RANKS.find((entry) => entry.tag === HOLDFASTS);
  if (!meta) return need;
  for (const step of planSteps(inventory, meta, Number.POSITIVE_INFINITY)) {
    for (const item of step.items)
      need.set(item.itemType, (need.get(item.itemType) ?? 0) + item.count);
  }
  return need;
}

/** need = what still-owed builds, the Holdfasts ranks left and the unbuilt
 *  Tektolyst artifacts ask for; spare is whatever is held past that. */
export function exchangeLedger(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
  targets: readonly AcquisitionTarget[],
  rankUpLabel: string,
): ExchangeLedger {
  const ownership = buildOwnership(inventory, itemDb);
  const rankUp = rankUpNeed(inventory);
  const artifacts = unownedArtifacts(inventory);
  const builds = new Map<string, number>();

  const artifactNeed = (uniqueName: string): ExchangeWanter[] =>
    artifacts.flatMap((artifact) =>
      artifact.prices
        .filter((price) => price.uniqueName === uniqueName)
        .map((price) => ({ name: artifact.name, count: price.count })),
    );
  const buildNeed = (uniqueName: string): number => {
    let need = builds.get(uniqueName);
    if (need === undefined) {
      const rows = resourceNeed(targets, uniqueName, itemDb, ownership);
      need = rows.normal + rows.prime + rows.subsume;
      builds.set(uniqueName, need);
    }
    return need;
  };

  return {
    needed: (uniqueName) =>
      buildNeed(uniqueName) +
      (rankUp.get(uniqueName) ?? 0) +
      artifactNeed(uniqueName).reduce((sum, row) => sum + row.count, 0),
    held: (uniqueName) => ownedComponentCount(uniqueName, ownership),
    wantedBy: (uniqueName) => {
      const rank = rankUp.get(uniqueName) ?? 0;
      return [
        ...resourceWanters(targets, uniqueName, ownership),
        ...(rank > 0 ? [{ name: rankUpLabel, count: rank }] : []),
        ...artifactNeed(uniqueName),
      ];
    },
  };
}

export function shortOf(ledger: ExchangeLedger, uniqueName: string): number {
  return Math.max(0, ledger.needed(uniqueName) - ledger.held(uniqueName));
}

export function spareOf(ledger: ExchangeLedger, uniqueName: string): number {
  return Math.max(0, ledger.held(uniqueName) - ledger.needed(uniqueName));
}

function offerRow(offer: ExchangeOffer, ledger: ExchangeLedger): ExchangeOfferRow {
  const upgrade = offer.kind === "upgrade";
  const costs = offer.prices.map((price) => {
    const spare = spareOf(ledger, price.uniqueName);
    return { ...price, spare, covers: spare >= price.max };
  });
  const covered = costs.filter((cost) => cost.covers).length;
  const held = ledger.held(offer.uniqueName);
  return {
    uniqueName: offer.uniqueName,
    name: offer.name,
    quantity: offer.quantity,
    kind: offer.kind,
    held,
    needed: upgrade ? 1 : ledger.needed(offer.uniqueName),
    short: upgrade ? (held > 0 ? 0 : 1) : shortOf(ledger, offer.uniqueName),
    wantedBy: upgrade ? [] : ledger.wantedBy(offer.uniqueName),
    costs,
    affordable: covered >= Math.min(PRICES_PER_OFFER, costs.length),
  };
}

/** Every offer the vendor could stock that gives something still short. */
export function neededOffers(vendor: ExchangeVendor, ledger: ExchangeLedger): ExchangeOfferRow[] {
  return TABLE[vendor].offers
    .map((offer) => offerRow(offer, ledger))
    .filter((row) => row.short > 0)
    .sort((a, b) => Number(b.affordable) - Number(a.affordable) || b.short - a.short);
}

/** Kuva is always worth having, so the weekly trade only asks for spare Pinions. */
function kuvaTrade(ledger: ExchangeLedger): ExchangeKuva | null {
  const kuva = TABLE.yonta.kuva;
  if (!kuva) return null;
  const spare = spareOf(ledger, kuva.price.uniqueName);
  return spare >= kuva.price.count ? { ...kuva, held: ledger.held(KUVA), spare } : null;
}

function matRows(
  offers: readonly ExchangeOfferRow[],
  kuva: ExchangeKuva | null,
  ledger: ExchangeLedger,
): ExchangeMat[] {
  const mats = new Map<string, ExchangeMat>();
  const mat = (uniqueName: string, name: string): ExchangeMat => {
    let row = mats.get(uniqueName);
    if (!row) {
      row = {
        uniqueName,
        name,
        held: ledger.held(uniqueName),
        needed: ledger.needed(uniqueName),
        spare: spareOf(ledger, uniqueName),
        wantedBy: ledger.wantedBy(uniqueName),
        prices: offers.map(() => null),
        kuva: null,
      };
      mats.set(uniqueName, row);
    }
    return row;
  };
  offers.forEach((offer, index) => {
    for (const cost of offer.costs) {
      mat(cost.uniqueName, cost.name).prices[index] = {
        min: cost.min,
        max: cost.max,
        covers: cost.covers,
      };
    }
  });
  if (kuva) mat(kuva.price.uniqueName, kuva.price.name).kuva = kuva.price.count;
  return [...mats.values()];
}

interface ExchangeWindow {
  key: string;
  expiry: string;
}

// Unverified: Yonta's 8h rotation and Marie's daily one are both assumed to start at 00:00 UTC.
export function exchangeWindow(vendor: ExchangeVendor, nowMs: number): ExchangeWindow {
  const span = TABLE[vendor].hours * HOUR_MS;
  const index = Math.floor(nowMs / span);
  return { key: `${vendor}:${index}`, expiry: new Date((index + 1) * span).toISOString() };
}

/** Null is a vendor with nothing worth the trip: no needed offer the spare pays
 *  for, and no open Kuva trade. `dismissed` drops the offers for this window. */
export function vendorExchange(
  vendor: ExchangeVendor,
  ledger: ExchangeLedger,
  window: ExchangeWindow,
  opts: { kuvaOpen: boolean; dismissed: boolean },
): ExchangeDetails | null {
  const offers = opts.dismissed ? [] : neededOffers(vendor, ledger);
  const kuva = vendor === "yonta" && opts.kuvaOpen ? kuvaTrade(ledger) : null;
  const buyable = offers.filter((offer) => offer.affordable);
  if (buyable.length === 0 && !kuva) return null;
  const pay = new Map<string, ExchangeSpare>();
  for (const offer of buyable) {
    for (const cost of offer.costs) {
      if (cost.covers)
        pay.set(cost.uniqueName, {
          uniqueName: cost.uniqueName,
          name: cost.name,
          spare: cost.spare,
        });
    }
  }
  const shown = buyable.length > 0 ? offers : [];
  return {
    vendor,
    window: window.key,
    hours: TABLE[vendor].hours,
    offers: shown,
    pay: [...pay.values()],
    kuva,
    mats: matRows(shown, kuva, ledger),
  };
}
