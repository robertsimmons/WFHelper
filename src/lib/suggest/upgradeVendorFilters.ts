import type { MessageKey, Translator } from "../i18n.js";
import type {
  ItemDbEntry,
  RawInventoryData,
  UpgradeVendorId,
  UpgradeVendorSource,
} from "../../types/inventory.js";
import {
  compactAmount,
  upgradeVendorCost,
  upgradeVendorDetail,
  upgradeVendorHeader,
  upgradeVendorName,
  type UpgradeCard,
  type UpgradeCatalog,
  type UpgradeKind,
} from "./upgrades.js";
import { miscItemCount } from "./vosfor.js";

const BARO_NAME_KEY = "/Lotus/Language/G1Quests/VoidTraderName";
const DUCATS = "/Lotus/Types/Items/MiscItems/PrimeBucks";
const NIGHTWAVE_TAG = /^RadioLegion\w*Syndicate$/;

interface VendorMatch {
  syndicate?: string | RegExp;
  id?: UpgradeVendorId;
  nameKey?: string;
}

interface UpgradeVendorOptionDef {
  id: string;
  labelKey: MessageKey;
  matches: readonly VendorMatch[];
}

interface UpgradeVendorGroup {
  id: string;
  labelKey: MessageKey;
  options: readonly UpgradeVendorOptionDef[];
}

const tag = (syndicate: string | RegExp): VendorMatch[] => [{ syndicate }];
const vendor = (id: UpgradeVendorId): VendorMatch[] => [{ id }];

export const UPGRADE_VENDOR_GROUPS: readonly UpgradeVendorGroup[] = [
  {
    id: "relay",
    labelKey: "nextUp.vendorGroupRelay",
    options: [
      {
        id: "steelMeridian",
        labelKey: "nextUp.vendorSteelMeridian",
        matches: tag("SteelMeridianSyndicate"),
      },
      { id: "arbiters", labelKey: "nextUp.vendorArbiters", matches: tag("ArbitersSyndicate") },
      { id: "suda", labelKey: "nextUp.vendorSuda", matches: tag("CephalonSudaSyndicate") },
      { id: "perrin", labelKey: "nextUp.vendorPerrin", matches: tag("PerrinSyndicate") },
      { id: "redVeil", labelKey: "nextUp.vendorRedVeil", matches: tag("RedVeilSyndicate") },
      { id: "newLoka", labelKey: "nextUp.vendorNewLoka", matches: tag("NewLokaSyndicate") },
    ],
  },
  {
    id: "hubs",
    labelKey: "nextUp.vendorGroupHubs",
    options: [
      { id: "ostron", labelKey: "nextUp.vendorOstron", matches: tag("CetusSyndicate") },
      { id: "quills", labelKey: "nextUp.vendorQuills", matches: tag("QuillsSyndicate") },
      { id: "solaris", labelKey: "nextUp.vendorSolaris", matches: tag("SolarisSyndicate") },
      { id: "vox", labelKey: "nextUp.vendorVox", matches: tag("VoxSyndicate") },
      { id: "ventkids", labelKey: "nextUp.vendorVentkids", matches: tag("VentKidsSyndicate") },
      { id: "entrati", labelKey: "nextUp.vendorEntrati", matches: tag("EntratiSyndicate") },
      { id: "necraloid", labelKey: "nextUp.vendorNecraloid", matches: tag("NecraloidSyndicate") },
      { id: "cavia", labelKey: "nextUp.vendorCavia", matches: tag("EntratiLabSyndicate") },
      { id: "holdfasts", labelKey: "nextUp.vendorHoldfasts", matches: tag("ZarimanSyndicate") },
      { id: "hex", labelKey: "nextUp.vendorHex", matches: tag("HexSyndicate") },
      { id: "kahl", labelKey: "nextUp.vendorKahl", matches: tag("KahlSyndicate") },
    ],
  },
  {
    id: "standing",
    labelKey: "nextUp.vendorGroupStanding",
    options: [
      { id: "simaris", labelKey: "nextUp.vendorSimaris", matches: tag("LibrarySyndicate") },
      { id: "conclave", labelKey: "nextUp.vendorConclave", matches: tag("ConclaveSyndicate") },
      { id: "nightwave", labelKey: "dailies.groupNightwave", matches: tag(NIGHTWAVE_TAG) },
    ],
  },
  {
    id: "shops",
    labelKey: "nextUp.vendorGroupShops",
    options: [
      {
        id: "arbitrationHonors",
        labelKey: "nextUp.modVendorArbitrationHonors",
        matches: vendor("arbitrationHonors"),
      },
      {
        id: "steelPathHonors",
        labelKey: "world.steelPathHonorsReset",
        matches: vendor("steelPathHonors"),
      },
      { id: "baro", labelKey: "world.baroKiteer", matches: [{ nameKey: BARO_NAME_KEY }] },
      {
        id: "archimedeanYonta",
        labelKey: "nextUp.modVendorArchimedeanYonta",
        matches: vendor("archimedeanYonta"),
      },
      { id: "acrithis", labelKey: "nextUp.modVendorAcrithis", matches: vendor("acrithis") },
      { id: "roathe", labelKey: "nextUp.modVendorRoathe", matches: vendor("roathe") },
    ],
  },
];

export const UPGRADE_VENDOR_OPTIONS: readonly string[] = UPGRADE_VENDOR_GROUPS.flatMap((group) =>
  group.options.map((option) => option.id),
);

const OPTION_BY_ID = new Map(
  UPGRADE_VENDOR_GROUPS.flatMap((group) => group.options.map((option) => [option.id, option])),
);

function fits(source: UpgradeVendorSource, match: VendorMatch): boolean {
  if (match.id) return source.id === match.id;
  if (match.nameKey) return source.nameKey === match.nameKey;
  const wanted = match.syndicate;
  if (!wanted || !source.syndicate) return false;
  return typeof wanted === "string" ? source.syndicate === wanted : wanted.test(source.syndicate);
}

export function vendorMatchesOption(source: UpgradeVendorSource, optionId: string): boolean {
  return OPTION_BY_ID.get(optionId)?.matches.some((match) => fits(source, match)) ?? false;
}

/** The card's first vendor that answers any of the picked options. */
export function pickedVendor(
  card: Pick<UpgradeCard, "vendors">,
  picked: readonly string[],
): UpgradeVendorSource | null {
  if (picked.length === 0) return null;
  return (
    card.vendors.find((source) => picked.some((id) => vendorMatchesOption(source, id))) ?? null
  );
}

export function cardMatchesVendors(
  card: Pick<UpgradeCard, "vendors">,
  picked: readonly string[],
): boolean {
  return picked.length === 0 || pickedVendor(card, picked) !== null;
}

const availability = new Map<UpgradeKind, { itemDb: unknown; ids: Set<string> }>();

/** Options any upgrade on the kind's whole list is sold by, whatever is shown. */
export function availableVendorOptions(
  catalog: UpgradeCatalog,
  itemDb: Record<string, ItemDbEntry>,
): Set<string> {
  const held = availability.get(catalog.kind);
  if (held?.itemDb === itemDb) return held.ids;
  const ids = new Set<string>();
  for (const entry of catalog.entries(itemDb)) {
    const { vendors } = catalog.build(entry, itemDb, null);
    for (const id of UPGRADE_VENDOR_OPTIONS) {
      if (!ids.has(id) && vendors.some((source) => vendorMatchesOption(source, id))) ids.add(id);
    }
  }
  availability.set(catalog.kind, { itemDb, ids });
  return ids;
}

/** What the player holds of what the vendor charges; null where it cannot be known. */
export function vendorBalance(
  source: UpgradeVendorSource,
  inventory: RawInventoryData | null,
): number | null {
  const cost = source.cost;
  if (!cost || !inventory) return null;
  switch (cost.unit) {
    case "standing": {
      const rows = (inventory as Record<string, unknown>)["Affiliations"];
      if (!source.syndicate || !Array.isArray(rows)) return null;
      const row = (rows as Array<{ Tag?: unknown; Standing?: unknown }>).find(
        (entry) => entry?.Tag === source.syndicate,
      );
      if (!row) return null;
      return typeof row.Standing === "number" ? row.Standing : 0;
    }
    case "item":
    case "cred":
      return cost.currency ? miscItemCount(inventory, cost.currency) : null;
    case "ducats":
      return miscItemCount(inventory, DUCATS);
    case "plat":
      return null;
  }
}

/** The source line while vendors are picked: the picked seller, and its price
 *  against what the player holds of the currency where that is known. */
export function pickedVendorLine(
  card: Pick<UpgradeCard, "vendors">,
  picked: readonly string[],
  inventory: RawInventoryData | null,
  t: Translator,
): { text: string; title: string; amount: string } | null {
  const source = pickedVendor(card, picked);
  if (!source) return null;
  const cost = upgradeVendorCost(source, t);
  const balance = vendorBalance(source, inventory);
  const amount =
    balance !== null && source.cost
      ? `${compactAmount(source.cost.amount)} / ${compactAmount(balance)}`
      : cost;
  const where = [upgradeVendorHeader(source, t), ...upgradeVendorDetail(source, t), cost];
  return { text: upgradeVendorName(source, t), title: where.filter(Boolean).join(" · "), amount };
}
