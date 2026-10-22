// Builds src/data/suggest/vendorExchange.json - what Archimedean Yonta and Marie
// Leroux can stock and the resources each offer can be priced in - from the
// bundled warframe-public-export-plus ExportVendors.
// Usage: node scripts/suggest/build-vendor-exchange.mjs

import path from "node:path";

import { DATA_DIR, loadLocalizationDict, readPublicExport, writeJsonAtomic } from "./io.mjs";

const OUT_FILE = path.join(DATA_DIR, "vendorExchange.json");

const MANIFESTS = "/Lotus/Types/Game/VendorManifests";
const YONTA_COMMISSIONS = `${MANIFESTS}/Zariman/ZarimanCommisionsManifestArchimedean`;
const YONTA_WEEKLY = `${MANIFESTS}/Zariman/ArchimedeanVendorManifest`;
const MARIE_EXCHANGE = `${MANIFESTS}/Tau/Prequel/TriadExchangeVendorManifest`;
const MARIE_ANTIQUES = `${MANIFESTS}/Tau/Prequel/TriadAntiqueVendorManifest`;
const KUVA = "/Lotus/Types/Items/MiscItems/Kuva";
// Bin 3 pays out Ignia and Maphica, which nothing here tracks a need for.
const MARIE_BINS = [0, 1, 2];

const vendors = readPublicExport("ExportVendors.json") ?? {};
const bundles = readPublicExport("ExportBundles.json") ?? {};
const named = [
  readPublicExport("ExportResources.json") ?? {},
  readPublicExport("ExportUpgrades.json") ?? {},
  readPublicExport("ExportArcanes.json") ?? {},
];
const version = readPublicExport("package.json")?.version ?? "unknown";
const loc = loadLocalizationDict();

function typeOf(storeItem) {
  return storeItem.replace("/StoreItems/", "/");
}

function nameOf(uniqueName) {
  for (const table of named) {
    const tag = table[uniqueName]?.name;
    if (tag) return loc(tag) ?? uniqueName;
  }
  return uniqueName;
}

/** A Yonta commission is a package wrapping the one plume it hands over. */
function givenBy(storeItem) {
  const component = bundles[storeItem]?.components?.[0];
  if (component)
    return { uniqueName: typeOf(component.typeName), quantity: component.purchaseQuantity };
  return { uniqueName: typeOf(storeItem), quantity: null };
}

function priceList(manifest, bin) {
  return (manifest.randomItemPricesPerBin?.[bin] ?? []).map((price) => ({
    uniqueName: price.type,
    name: nameOf(price.type),
    min: price.count.minValue,
    max: price.count.maxValue,
  }));
}

function offersOf(manifest, bins) {
  return manifest.items
    .filter((item) => bins === null || bins.includes(item.bin))
    .map((item) => {
      const given = givenBy(item.storeItem);
      return {
        uniqueName: given.uniqueName,
        name: nameOf(given.uniqueName),
        quantity: given.quantity ?? item.quantity,
        kind: /\/Upgrades\//.test(given.uniqueName) ? "upgrade" : "resource",
        prices: priceList(manifest, item.bin),
      };
    });
}

/** The artifacts are in no export but the stall's own, so the name is the path's. */
function artifactName(storeItem) {
  const folder = storeItem.split("/").at(-2) ?? storeItem;
  return folder.replace(/([a-z])([A-Z])/g, "$1 $2");
}

const commissions = vendors[YONTA_COMMISSIONS];
const weekly = vendors[YONTA_WEEKLY];
const exchange = vendors[MARIE_EXCHANGE];
const antiques = vendors[MARIE_ANTIQUES];
if (!commissions || !weekly || !exchange || !antiques) {
  console.error("a vendor manifest is missing from the export - refusing to overwrite");
  process.exit(1);
}

const kuva = weekly.items.find((item) => typeOf(item.storeItem) === KUVA);
const data = {
  source: `warframe-public-export-plus ${version} ExportVendors`,
  yonta: {
    hours: commissions.items[0]?.durationHours ?? 8,
    offers: offersOf(commissions, null),
    kuva: kuva
      ? {
          quantity: kuva.quantity,
          price: {
            uniqueName: kuva.itemPrices[0].ItemType,
            name: nameOf(kuva.itemPrices[0].ItemType),
            count: kuva.itemPrices[0].ItemCount,
          },
        }
      : null,
  },
  marie: {
    hours: exchange.items[0]?.durationHours ?? 24,
    offers: offersOf(exchange, MARIE_BINS),
    artifacts: antiques.items.map((item) => ({
      storeItem: item.storeItem,
      uniqueName: typeOf(item.storeItem),
      name: artifactName(item.storeItem),
      prices: item.itemPrices.map((price) => ({
        uniqueName: price.ItemType,
        name: nameOf(price.ItemType),
        count: price.ItemCount,
      })),
    })),
  },
};

if (data.yonta.offers.length === 0 || data.marie.offers.length === 0) {
  console.error("no offers resolved - refusing to overwrite");
  process.exit(1);
}

await writeJsonAtomic(OUT_FILE, data);
console.log(
  `wrote ${OUT_FILE} with ${data.yonta.offers.length} Yonta and ${data.marie.offers.length} Marie offers`,
);
