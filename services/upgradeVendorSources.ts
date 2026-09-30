import type { UpgradeVendorCost, UpgradeVendorHub, UpgradeVendorId } from "./types/gameData";

export interface StoredVendorCost {
  amount: number;
  unit: UpgradeVendorCost["unit"];
  /** The currency's uniqueName where `unit` is `item`. */
  currency?: string;
  credits?: number;
}

export type BaroPrices = Record<string, { ducats?: number; credits?: number }>;

export interface StoredVendorRank {
  level: number | null;
  title?: string;
  titleKey?: string;
}

export interface StoredVendorSource {
  name?: string;
  nameKey?: string;
  id?: UpgradeVendorId;
  cost?: StoredVendorCost;
  rank?: StoredVendorRank;
  keeper?: string;
  hub?: UpgradeVendorHub;
  covers?: string[];
  /** The ExportSyndicates tag whose standing or rank the offer runs on. */
  syndicate?: string;
}

interface PepVendorOffer {
  storeItem?: string;
  itemPrices?: { ItemCount?: number; ItemType?: string }[];
  platinum?: unknown;
  syndicate?: { tag?: string; minRank?: number; standingCost?: number };
}

interface PepFavour {
  storeItem?: string;
  standingCost?: number;
  creditsCost?: number;
  requiredLevel?: number;
}

interface PepSyndicate {
  name?: string;
  titles?: { level?: number; name?: string }[];
  favours?: PepFavour[];
}

export interface PepVendorExports {
  ExportVendors?: Record<string, { items?: PepVendorOffer[] }>;
  ExportSyndicates?: Record<string, PepSyndicate>;
  ExportNightwave?: { affiliationTag?: string; rewards?: { uniqueName?: string }[] };
}

type NameResolver = (nameKey: string) => string | null;

const MANIFESTS = "/Lotus/Types/Game/VendorManifests/";

const NAMED_MANIFESTS: Record<string, UpgradeVendorId> = {
  "Hubs/EliteAlertVendorManifest": "arbitrationHonors",
  "Hubs/TeshinHardModeVendorManifest": "steelPathHonors",
  "Deimos/ConservationRewardsManifest": "son",
  "Ostron/ConservationRewardsManifest": "teasonai",
  "Solaris/ConservationRewardsManifest": "theBusiness",
  "Duviri/AcrithisVendorManifest": "acrithis",
  "Kahl/ChipperVendorManifest": "chipper",
  "Zariman/ArchimedeanVoidEclipseManifest": "archimedeanYonta",
  "Tau/Prequel/TriadEventVendorManifest": "devilsTriad",
  "Tau/Prequel/TriadPityVendorManifest": "devilsTriad",
  "Tau/Prequel/TriadExchangeVendorManifest": "devilsTriad",
  "TheHex/Nova1999ConquestShopManifest": "temporalArchimedea",
};

/** Manifests whose keeper DE does name, just not on the manifest. */
const KEYED_MANIFESTS: Record<string, string> = {
  "Deimos/OtakLastWishManifest": "/Lotus/Language/Bosses/Otak",
  "Hubs/HunhowVendorManifest": "/Lotus/Language/Game/HunhowName",
  "Solaris/NightcapVendorManifest": "/Lotus/Language/NokkoColony/NokkoVendorName",
  "GameModes/AscensionVendorManifest": "/Lotus/Language/Missions/MissionName_Ascension",
};

// Past Nightwave seasons and one-off events keep their offerings after they close.
const RETIRED_SYNDICATE = /^(RadioLegion|EventSyndicate$)/;

const NIGHTWAVE_CREDS = /\/NoraIntermission\w*Creds$/;

const BARO_NAME_KEY = "/Lotus/Language/G1Quests/VoidTraderName";

const PRIMED_NOT_FROM_BARO = new Set([
  "primed chamber",
  "primed regen",
  "primed smite the murmur",
  "primed expel the murmur",
  "primed bane of the murmur",
  "primed cleanse the murmur",
]);

const EARTH_CETUS: UpgradeVendorHub = { region: "Earth", place: "Cetus" };
const VENUS_FORTUNA: UpgradeVendorHub = { region: "Venus", place: "Fortuna" };
const DEIMOS_NECRALISK: UpgradeVendorHub = { region: "Deimos", place: "Necralisk" };
const RELAY: UpgradeVendorHub = { region: null, place: "Relay" };
const DRIFTERS_CAMP: UpgradeVendorHub = { region: null, place: "Drifter's Camp" };
const CHRYSALITH: UpgradeVendorHub = { region: "Zariman", place: "Chrysalith" };

/** Where each shop stands; the exports name the seller but never the hub. */
const SYNDICATE_HUBS: Record<string, UpgradeVendorHub> = {
  CetusSyndicate: EARTH_CETUS,
  QuillsSyndicate: EARTH_CETUS,
  SolarisSyndicate: VENUS_FORTUNA,
  VoxSyndicate: VENUS_FORTUNA,
  VentKidsSyndicate: VENUS_FORTUNA,
  EntratiSyndicate: DEIMOS_NECRALISK,
  NecraloidSyndicate: DEIMOS_NECRALISK,
  EntratiLabSyndicate: { region: "Deimos", place: "Sanctum Anatomica" },
  ZarimanSyndicate: CHRYSALITH,
  HexSyndicate: { region: null, place: "Höllvania" },
  KahlSyndicate: DRIFTERS_CAMP,
  ArbitersSyndicate: RELAY,
  CephalonSudaSyndicate: RELAY,
  NewLokaSyndicate: RELAY,
  PerrinSyndicate: RELAY,
  RedVeilSyndicate: RELAY,
  SteelMeridianSyndicate: RELAY,
  ConclaveSyndicate: RELAY,
  LibrarySyndicate: RELAY,
};

const ID_HUBS: Partial<Record<UpgradeVendorId, UpgradeVendorHub>> = {
  arbitrationHonors: RELAY,
  steelPathHonors: RELAY,
  son: DEIMOS_NECRALISK,
  teasonai: EARTH_CETUS,
  theBusiness: VENUS_FORTUNA,
  acrithis: { region: "Duviri", place: "Dormizone" },
  chipper: DRIFTERS_CAMP,
  archimedeanYonta: CHRYSALITH,
};

const NAME_KEY_HUBS: Record<string, UpgradeVendorHub> = {
  [BARO_NAME_KEY]: RELAY,
  "/Lotus/Language/NokkoColony/NokkoVendorName": VENUS_FORTUNA,
};

function hubOf(source: StoredVendorSource, tag?: string): UpgradeVendorHub | undefined {
  if (tag && SYNDICATE_HUBS[tag]) return SYNDICATE_HUBS[tag];
  if (source.id) return ID_HUBS[source.id];
  return source.nameKey ? NAME_KEY_HUBS[source.nameKey] : undefined;
}

function located(source: StoredVendorSource, tag?: string): StoredVendorSource {
  const hub = hubOf(source, tag);
  return hub ? { ...source, hub } : source;
}

function rankOf(
  syndicate: PepSyndicate | undefined,
  level: number | undefined,
  resolveName: NameResolver,
): StoredVendorRank | undefined {
  if (!level || level <= 0) return undefined;
  const titleKey = syndicate?.titles?.find((title) => title.level === level)?.name;
  const title = titleKey ? resolveName(titleKey) : null;
  return title && titleKey ? { level, title, titleKey } : { level };
}

function upgradeUniqueName(storeItem: string): string {
  return storeItem.replace(/^\/Lotus\/StoreItems\//, "/Lotus/");
}

function favourCost(favour: PepFavour): StoredVendorCost | undefined {
  const standing = favour.standingCost ?? 0;
  if (standing <= 0) return undefined;
  const credits = favour.creditsCost ?? 0;
  return credits > 0
    ? { amount: standing, unit: "standing", credits }
    : { amount: standing, unit: "standing" };
}

function offerCost(offer: PepVendorOffer): StoredVendorCost | undefined {
  const standing = offer.syndicate?.standingCost;
  if (typeof standing === "number" && standing > 0) return { amount: standing, unit: "standing" };
  const prices = offer.itemPrices ?? [];
  const [price] = prices;
  if (prices.length === 1 && price?.ItemType && (price.ItemCount ?? 0) > 0) {
    const amount = price.ItemCount as number;
    return NIGHTWAVE_CREDS.test(price.ItemType)
      ? { amount, unit: "cred" }
      : { amount, unit: "item", currency: price.ItemType };
  }
  if (prices.length === 0 && typeof offer.platinum === "number" && offer.platinum > 0) {
    return { amount: offer.platinum, unit: "plat" };
  }
  return undefined;
}

function withCost(source: StoredVendorSource, cost: StoredVendorCost | undefined) {
  return cost ? { ...source, cost } : source;
}

function favourSource(
  tag: string,
  syndicate: PepSyndicate,
  favour: PepFavour,
  resolveName: NameResolver,
): StoredVendorSource {
  const name = syndicate.name ? resolveName(syndicate.name) : null;
  const base = withCost(
    located({ ...(name ? { name } : {}), nameKey: syndicate.name, syndicate: tag }, tag),
    favourCost(favour),
  );
  const rank = rankOf(syndicate, favour.requiredLevel, resolveName);
  return rank ? { ...base, rank } : base;
}

/** Mod or arcane uniqueName to where it is bought, in syndicate, named vendor,
 *  Nightwave order. */
export function collectUpgradeVendorSources(
  pep: PepVendorExports,
  resolveName: NameResolver,
  isUpgrade: (uniqueName: string) => boolean,
): Map<string, StoredVendorSource[]> {
  const out = new Map<string, StoredVendorSource[]>();

  function add(storeItem: string | undefined, source: StoredVendorSource): void {
    if (!storeItem) return;
    const uniqueName = upgradeUniqueName(storeItem);
    if (!isUpgrade(uniqueName)) return;
    const list = out.get(uniqueName) ?? [];
    if (list.some((held) => held.id === source.id && held.name === source.name)) return;
    list.push(source);
    out.set(uniqueName, list);
  }

  const syndicates = pep.ExportSyndicates ?? {};
  for (const [tag, syndicate] of Object.entries(syndicates)) {
    if (RETIRED_SYNDICATE.test(tag) || !syndicate.name) continue;
    const name = resolveName(syndicate.name);
    if (!name) continue;
    for (const favour of syndicate.favours ?? []) {
      add(favour.storeItem, favourSource(tag, syndicate, favour, resolveName));
    }
  }

  const vendors = pep.ExportVendors ?? {};
  function offerSource(source: StoredVendorSource, offer: PepVendorOffer): StoredVendorSource {
    const gate = offer.syndicate;
    const rank = rankOf(gate?.tag ? syndicates[gate.tag] : undefined, gate?.minRank, resolveName);
    const priced = withCost(located(source), offerCost(offer));
    const tagged = gate?.tag ? { ...priced, syndicate: gate.tag } : priced;
    return rank ? { ...tagged, rank } : tagged;
  }
  for (const [manifest, id] of Object.entries(NAMED_MANIFESTS)) {
    for (const offer of vendors[MANIFESTS + manifest]?.items ?? []) {
      add(offer.storeItem, offerSource({ id }, offer));
    }
  }
  for (const [manifest, nameKey] of Object.entries(KEYED_MANIFESTS)) {
    const name = resolveName(nameKey);
    if (!name) continue;
    for (const offer of vendors[MANIFESTS + manifest]?.items ?? []) {
      add(offer.storeItem, offerSource({ name, nameKey }, offer));
    }
  }

  const nightwave = pep.ExportNightwave;
  const tag = nightwave?.affiliationTag;
  const nameKey = tag ? syndicates[tag]?.name : undefined;
  const name = nameKey ? resolveName(nameKey) : null;
  if (tag && nameKey && name) {
    const source: StoredVendorSource = { name, nameKey };
    const shop = vendors[`${MANIFESTS}Events/${tag.replace(/Syndicate$/, "VendorManifest")}`];
    for (const offer of shop?.items ?? []) add(offer.storeItem, withCost(source, offerCost(offer)));
    for (const reward of nightwave?.rewards ?? []) add(reward.uniqueName, source);
  }

  return out;
}

export function withBaroPrice(
  source: StoredVendorSource,
  itemName: string,
  prices: BaroPrices,
): StoredVendorSource {
  if (source.nameKey !== BARO_NAME_KEY || source.cost) return source;
  const price = prices[itemName.toLowerCase().replace(/\s+/g, " ").trim()];
  if (!price?.ducats) return source;
  const cost: StoredVendorCost = { amount: price.ducats, unit: "ducats" };
  return { ...source, cost: price.credits ? { ...cost, credits: price.credits } : cost };
}

const SYNDICATE_ROW = /^([^,(]+?)\s*(?:\(([^)]+)\))?,\s*([^,]+)$/;

interface RowSyndicate {
  tag: string;
  syndicate: PepSyndicate;
  rank: StoredVendorRank;
}

function rowSyndicate(
  name: string,
  title: string,
  pep: PepVendorExports,
  resolveName: NameResolver,
): RowSyndicate | null {
  const spelled = name.toLowerCase();
  // DE's `CLEARANCE: ODIMA` is @wfcd's `Clearance Odima`.
  const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  for (const [tag, syndicate] of Object.entries(pep.ExportSyndicates ?? {})) {
    const own = syndicate.name ? resolveName(syndicate.name)?.toLowerCase() : null;
    // @wfcd says `Kahl's Garrison` where DE says `Garrison`.
    if (!own || (spelled !== own && !spelled.endsWith(` ${own}`))) continue;
    const held = syndicate.titles?.find(
      (entry) => entry.name && bare(resolveName(entry.name) ?? "") === bare(title),
    );
    if (!held?.name) continue;
    const resolved = resolveName(held.name) ?? title;
    const rank = { level: held.level ?? null, title: resolved, titleKey: held.name };
    return { tag, syndicate, rank };
  }
  return null;
}

/** @wfcd lists a syndicate purchase as a drop at `Syndicate (Keeper), Rank`. Each
 *  such row joins the offer the exports price, or becomes that offer itself. */
export function foldSyndicateRows(
  uniqueName: string,
  drops: readonly { location?: unknown }[],
  sources: readonly StoredVendorSource[],
  pep: PepVendorExports,
  resolveName: NameResolver,
): StoredVendorSource[] {
  const out = sources.map((source) => ({ ...source }));
  for (const drop of drops) {
    const location = typeof drop.location === "string" ? drop.location.trim() : "";
    const row = SYNDICATE_ROW.exec(location);
    if (!row || /\bRotation\b/i.test(location)) continue;
    const found = rowSyndicate(row[1].trim(), row[3].trim(), pep, resolveName);
    if (!found) continue;
    let target = out.find((source) => source.syndicate === found.tag);
    if (!target) {
      const favour = found.syndicate.favours?.find(
        (entry) => entry.storeItem && upgradeUniqueName(entry.storeItem) === uniqueName,
      );
      target = favour
        ? favourSource(found.tag, found.syndicate, favour, resolveName)
        : located(
            {
              name: resolveName(found.syndicate.name ?? "") ?? row[1].trim(),
              nameKey: found.syndicate.name,
              syndicate: found.tag,
            },
            found.tag,
          );
      out.push(target);
    }
    target.covers = [...(target.covers ?? []), location];
    if (row[2] && !target.keeper) target.keeper = row[2].trim();
    if (!target.rank) target.rank = found.rank;
  }
  return out;
}

/** Where a mod no export sells or drops comes from, by what its name says. */
export function ruleVendorSource(
  name: string,
  resolveName: NameResolver,
): StoredVendorSource | null {
  if (/^Primed /i.test(name) && !PRIMED_NOT_FROM_BARO.has(name.toLowerCase())) {
    const baro = resolveName(BARO_NAME_KEY);
    return baro ? located({ name: baro, nameKey: BARO_NAME_KEY }) : null;
  }
  if (/^Galvanized /i.test(name)) return located({ id: "arbitrationHonors" });
  return null;
}
