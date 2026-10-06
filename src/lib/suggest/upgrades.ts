import { toMarketSlug } from "../marketNaming.js";
import { getCachedPriceState } from "../wfm/priceCache.js";
import { rendererPriceCacheKey } from "../../../config/shared/wfmCacheKeys.js";
import { formatDropChance } from "../dropDisplay.js";
import {
  dropSourceDetail,
  dropSourceHeader,
  dropSourceLine,
  type DropSource,
} from "../dropSources.js";
import type { MessageKey, Translator } from "../i18n.js";
import type {
  DropInfo,
  ItemDbEntry,
  RawInventoryData,
  UpgradeVendorId,
  UpgradeVendorSource,
} from "../../types/inventory.js";

/** The two bands built off one popularity list each: mods and arcanes. */
export type UpgradeKind = "mods" | "arcanes";

/** One row of `src/data/suggest/{mods,arcanes}.json`, most popular first. */
export interface PopularUpgrade {
  name: string;
  /** Mods: items whose Overframe top list names it. Arcanes: builds slotting it. */
  count: number;
  wikiUrl: string;
}

/** Copies held toward max rank, where rank is paid for in copies. */
interface UpgradeCopies {
  held: number;
  max: number;
}

/** Everything an upgrade card, its pinned card and its modal draw. */
export interface UpgradeCard {
  kind: UpgradeKind;
  name: string;
  displayName?: string | undefined;
  uniqueName: string | null;
  imageUrl: string | null;
  count: number;
  wikiUrl: string;
  slot: string | null;
  polarity: string | null;
  rarity: string | null;
  drain: { min: number; max: number } | null;
  stats: string[];
  tradable: boolean;
  /** Median plat; null where it cannot be traded or nothing has priced it. */
  platinum: number | null;
  marketSlug: string | null;
  drops: DropInfo[];
  vendors: UpgradeVendorSource[];
  owned: boolean;
  /** Null for a mod, and for an arcane before the inventory is read. */
  copies: UpgradeCopies | null;
}

/** Lowercased English name to what the inventory holds of it; null while unread. */
export type Holdings = ReadonlyMap<string, number> | null;

/** What a band needs from its kind: the list, what is held, and the card. */
export interface UpgradeCatalog {
  kind: UpgradeKind;
  popular: readonly PopularUpgrade[];
  /** The popular list, then every other upgrade of the kind at a count of 0. */
  entries(itemDb: Record<string, ItemDbEntry>): readonly PopularUpgrade[];
  holdings(inventory: RawInventoryData | null, itemDb: Record<string, ItemDbEntry>): Holdings;
  owns(name: string, itemDb: Record<string, ItemDbEntry>, holdings: Holdings): boolean;
  build(
    entry: PopularUpgrade,
    itemDb: Record<string, ItemDbEntry>,
    holdings: Holdings,
  ): UpgradeCard;
}

type UpgradeSource =
  | { kind: "drop"; source: DropSource }
  | { kind: "vendor"; vendor: UpgradeVendorSource };

export function parsePopularList(raw: unknown): PopularUpgrade[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): PopularUpgrade[] => {
    if (!row || typeof row !== "object") return [];
    const { name, count, wikiUrl } = row as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) return [];
    return [
      {
        name: name.trim(),
        count: typeof count === "number" && Number.isFinite(count) ? count : 0,
        wikiUrl: typeof wikiUrl === "string" ? wikiUrl : "",
      },
    ];
  });
}

/** An eager glob's one module, or null where the data build has not written it. */
export function shippedModule(loaded: Record<string, unknown>): unknown {
  const module = Object.values(loaded)[0];
  if (!module || typeof module !== "object") return null;
  return (module as { default?: unknown }).default ?? module;
}

/** A card for a pinned name the list has lost, as one on no list at all. */
export function cardFor(
  catalog: UpgradeCatalog,
  name: string,
  itemDb: Record<string, ItemDbEntry>,
  holdings: Holdings,
): UpgradeCard {
  const key = name.toLowerCase();
  const listed = catalog.popular.find((entry) => entry.name.toLowerCase() === key);
  return catalog.build(listed ?? { name, count: 0, wikiUrl: "" }, itemDb, holdings);
}

interface IndexEntry {
  uniqueName: string;
  entry: ItemDbEntry;
}

/** By lowercased English name. Several paths share a name (PvP and flawed
 *  copies among them), so the one carrying @wfcd card facts wins. */
export function createNameIndex(
  isKind: (entry: ItemDbEntry) => boolean,
  hasFacts: (entry: ItemDbEntry) => boolean,
): (itemDb: Record<string, ItemDbEntry>) => Map<string, IndexEntry> {
  let source: Record<string, ItemDbEntry> | null = null;
  let index = new Map<string, IndexEntry>();
  return (itemDb) => {
    if (itemDb === source) return index;
    const next = new Map<string, IndexEntry>();
    for (const [uniqueName, entry] of Object.entries(itemDb)) {
      if (!entry?.name || !isKind(entry)) continue;
      const key = entry.name.toLowerCase();
      const held = next.get(key);
      if (held && (hasFacts(held.entry) || !hasFacts(entry))) continue;
      next.set(key, { uniqueName, entry });
    }
    source = itemDb;
    index = next;
    return index;
  };
}

/** Focus nodes and set bonuses ride on mod rows but are never held; a riven
 *  row is the unrolled placeholder, not a mod anyone can farm. */
const NOT_COLLECTIBLE_TYPES = new Set(["Focus Way", "Mod Set Mod"]);
const RIVEN_PLACEHOLDER = "/Upgrades/Mods/Randomized/";

function collectible({ uniqueName, entry }: IndexEntry): boolean {
  return !NOT_COLLECTIBLE_TYPES.has(entry.type ?? "") && !uniqueName.includes(RIVEN_PLACEHOLDER);
}

/** The popular list in its order, then every other upgrade the index holds by name. */
export function createEntries(
  popular: readonly PopularUpgrade[],
  index: (itemDb: Record<string, ItemDbEntry>) => Map<string, IndexEntry>,
): (itemDb: Record<string, ItemDbEntry>) => readonly PopularUpgrade[] {
  let source: Record<string, ItemDbEntry> | null = null;
  let entries: readonly PopularUpgrade[] = popular;
  return (itemDb) => {
    if (itemDb === source) return entries;
    const listed = new Set(popular.map((entry) => entry.name.toLowerCase()));
    const rest: PopularUpgrade[] = [];
    for (const [key, hit] of index(itemDb)) {
      if (listed.has(key) || !hit.entry.name || !collectible(hit)) continue;
      rest.push({ name: hit.entry.name, count: 0, wikiUrl: "" });
    }
    rest.sort((a, b) => a.name.localeCompare(b.name));
    source = itemDb;
    entries = [...popular, ...rest];
    return entries;
  };
}

function upgradeVendors(entry: ItemDbEntry | undefined): UpgradeVendorSource[] {
  return (entry?.vendors ?? []).filter((source) => source.name || source.id);
}

/** A priced purchase is as sure as a 10% drop; a shop with no known price as a
 *  1% one. A drop counts at its best chance, halved where no place is known. */
const PRICED_VENDOR = 10;
const UNPRICED_VENDOR = 1;

function placed(source: DropSource): boolean {
  return Boolean(source.region || source.spawn) || !["other", "enemy"].includes(source.kind);
}

function upgradeSourceScore(source: UpgradeSource): number {
  if (source.kind === "vendor") return source.vendor.cost ? PRICED_VENDOR : UNPRICED_VENDOR;
  const chance = source.source.best ?? 0;
  return placed(source.source) ? chance : chance / 2;
}

/** Every drop and every shop, surest first; a vendor wins a tie. A drop row
 *  that is really a syndicate purchase shows once, as the purchase. */
export function upgradeSources(card: UpgradeCard, places: readonly DropSource[]): UpgradeSource[] {
  const covered = new Set(card.vendors.flatMap((vendor) => vendor.covers ?? []));
  const drops = places.filter((source) => !source.raw.every((raw) => covered.has(raw.trim())));
  const all: UpgradeSource[] = [
    ...card.vendors.map((vendor): UpgradeSource => ({ kind: "vendor", vendor })),
    ...drops.map((source): UpgradeSource => ({ kind: "drop", source })),
  ];
  return all
    .map((source, index) => ({ source, index, score: upgradeSourceScore(source) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ source }) => source);
}

interface KindText {
  countOne: MessageKey;
  countMany: MessageKey;
  countTitle: MessageKey;
  searchPlaceholder: MessageKey;
}

export const UPGRADE_TEXT: Record<UpgradeKind, KindText> = {
  mods: {
    countOne: "nextUp.modOnListOne",
    countMany: "nextUp.modOnLists",
    countTitle: "nextUp.modOnListsTitle",
    searchPlaceholder: "nextUp.modSearchPlaceholder",
  },
  arcanes: {
    countOne: "nextUp.arcaneOnBuildOne",
    countMany: "nextUp.arcaneOnBuilds",
    countTitle: "nextUp.arcaneOnBuildsTitle",
    searchPlaceholder: "nextUp.arcaneSearchPlaceholder",
  },
};

export function upgradeCountText(card: UpgradeCard, t: Translator): string {
  const text = UPGRADE_TEXT[card.kind];
  return t(card.count === 1 ? text.countOne : text.countMany, { count: String(card.count) });
}

export function upgradeCopiesText(card: UpgradeCard, t: Translator): string {
  const copies = card.copies;
  return copies
    ? t("nextUp.arcaneCopies", { held: String(copies.held), max: String(copies.max) })
    : "";
}

const VENDOR_NAMES: Record<UpgradeVendorId, MessageKey> = {
  arbitrationHonors: "nextUp.modVendorArbitrationHonors",
  steelPathHonors: "world.steelPathHonorsReset",
  son: "nextUp.modVendorSon",
  teasonai: "nextUp.modVendorTeasonai",
  theBusiness: "nextUp.modVendorTheBusiness",
  acrithis: "nextUp.modVendorAcrithis",
  chipper: "nextUp.modVendorChipper",
  archimedeanYonta: "nextUp.modVendorArchimedeanYonta",
  devilsTriad: "nextUp.modVendorDevilsTriad",
  temporalArchimedea: "nextUp.modVendorTemporalArchimedea",
  roathe: "nextUp.modVendorRoathe",
};

export function upgradeVendorName(source: UpgradeVendorSource, t: Translator): string {
  if (source.name) return source.name;
  return source.id ? t(VENDOR_NAMES[source.id]) : "";
}

export function compactAmount(amount: number): string {
  return amount >= 1000 ? `${Number((amount / 1000).toFixed(1))}k` : String(amount);
}

export function upgradeVendorCost(source: UpgradeVendorSource, t: Translator): string {
  const cost = source.cost;
  if (!cost) return "";
  const amount = compactAmount(cost.amount);
  switch (cost.unit) {
    case "standing":
      return t("dailies.standing", { amount });
    case "cred":
      return t("nextUp.modCostCred", { amount });
    case "plat":
      return t("nextUp.modCostPlat", { amount });
    case "item":
      return cost.item ? t("nextUp.modCostItem", { amount, item: cost.item }) : "";
    case "ducats":
      return t("nextUp.modCostDucats", { amount });
  }
}

/** DE shouts some titles: `CLEARANCE: ODIMA`. */
function rankTitle(title: string | null): string | null {
  if (!title || title !== title.toUpperCase() || title === title.toLowerCase()) return title;
  return title
    .toLowerCase()
    .replace(/(^|[\s:-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

export function upgradeVendorRank(source: UpgradeVendorSource, t: Translator): string {
  const rank = source.rank;
  if (!rank) return "";
  const title = rankTitle(rank.title);
  if (rank.level !== null && title) {
    return t("syndicates.stepTitle", { level: String(rank.level), title });
  }
  if (rank.level !== null) return t("browse.rankValue", { value: String(rank.level) });
  return title ?? "";
}

/** The hub, as a drop tile heads with its place; the seller where none is known. */
export function upgradeVendorHeader(source: UpgradeVendorSource, t: Translator): string {
  const hub = source.hub;
  return hub ? [hub.region, hub.place].filter(Boolean).join(" · ") : upgradeVendorName(source, t);
}

/** Seller, keeper and rank gate, whatever the header has not already said. */
export function upgradeVendorDetail(source: UpgradeVendorSource, t: Translator): string[] {
  const name = source.hub ? upgradeVendorName(source, t) : "";
  const keeper = source.keeper && source.keeper !== name ? source.keeper : "";
  return [name, keeper, upgradeVendorRank(source, t)].filter(Boolean);
}

interface UpgradeSourceLine {
  text: string;
  title: string;
  amount: string;
}

/** The card's one line: the surest source, what it costs or how often it drops. */
export function bestUpgradeLine(
  card: UpgradeCard,
  places: readonly DropSource[],
  t: Translator,
): UpgradeSourceLine | null {
  const best = upgradeSources(card, places)[0];
  if (!best) return null;
  if (best.kind === "drop") {
    const { text, chance } = dropSourceLine(best.source, t);
    const where = [dropSourceHeader(best.source, t), ...dropSourceDetail(best.source, t)];
    return {
      text,
      title: [where.join(" · "), ...best.source.raw].join("\n"),
      amount: chance === null ? "" : formatDropChance(chance),
    };
  }
  const vendor = best.vendor;
  const amount = upgradeVendorCost(vendor, t);
  const where = [upgradeVendorHeader(vendor, t), ...upgradeVendorDetail(vendor, t)];
  return { text: upgradeVendorName(vendor, t), title: where.join(" · "), amount };
}

export function upgradeVendorCredits(source: UpgradeVendorSource, t: Translator): string {
  const credits = source.cost?.credits;
  return credits ? t("nextUp.modCostCredits", { amount: compactAmount(credits) }) : "";
}

/** Both trade by rank, and an unranked copy is what a player farming one sells. */
export function upgradePlatinum(name: string): number | null {
  const slug = toMarketSlug(name);
  if (!slug) return null;
  for (const rank of [0, null]) {
    const entry = getCachedPriceState(rendererPriceCacheKey(slug, rank));
    if (entry?.status === "ok") return entry.median;
  }
  return null;
}

/** The facts every kind carries the same way, off its item database row. */
export function commonCardFields(
  entry: PopularUpgrade,
  hit: IndexEntry | undefined,
): Pick<
  UpgradeCard,
  | "name"
  | "displayName"
  | "uniqueName"
  | "imageUrl"
  | "count"
  | "wikiUrl"
  | "tradable"
  | "platinum"
  | "marketSlug"
  | "drops"
  | "vendors"
> {
  const db = hit?.entry;
  const tradable = db?.tradable === true;
  return {
    name: entry.name,
    ...(db?.displayName ? { displayName: db.displayName } : {}),
    uniqueName: hit?.uniqueName ?? null,
    imageUrl: db?.imageUrl ?? null,
    count: entry.count,
    wikiUrl: entry.wikiUrl,
    tradable,
    platinum: tradable ? upgradePlatinum(entry.name) : null,
    marketSlug: tradable ? toMarketSlug(entry.name) || null : null,
    drops: db?.drops ?? [],
    vendors: upgradeVendors(db),
  };
}
