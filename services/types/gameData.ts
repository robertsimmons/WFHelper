/** Fields consumed from DE public exports and WFCD items. */

/** A single item from any PEP Export* record. */
export interface PepExportItem {
  name: string;
  description?: string;
  resultType?: string;
  icon?: string;
  masteryReq?: number;
  primeSellingPrice?: number;
  tradable?: boolean;
  vaulted?: boolean;
  productCategory?: string;
  era?: string;
  category?: string;
  bayonetOtherWeaponType?: string;
}

interface RecipeIngredient {
  uniqueName: string;
  count: number;
}

export interface RecipeData {
  buildPrice: number;
  buildTime: number;
  num: number;
  blueprintUniqueName?: string;
  reusableBlueprint?: boolean;
  ingredients: RecipeIngredient[];
}

export interface DropEntry {
  location: string;
  type: string;
  chance: number;
  rarity: string;
}

/** What a mod's own card says, off @wfcd/items. */
export interface ModFacts {
  polarity: string | null;
  rarity: string | null;
  baseDrain: number | null;
  fusionLimit: number | null;
  /** The slot it fits: `Melee`, `Primary`, `Warframe`, or one item's name. */
  compatName: string | null;
  /** The last rank's stat lines. */
  maxRankStats: string[];
}

/** What an arcane's own card says, off @wfcd/items. */
export interface ArcaneFacts {
  /** @wfcd's type with the `Arcane` dropped: `Warframe`, `Operator`, `Zaw`. */
  slot: string | null;
  rarity: string | null;
  maxRank: number;
  /** The last rank's stat lines. */
  maxRankStats: string[];
}

/** Vendors DE's exports leave unnamed; the renderer holds their text. */
export type UpgradeVendorId =
  | "arbitrationHonors"
  | "steelPathHonors"
  | "son"
  | "teasonai"
  | "theBusiness"
  | "acrithis"
  | "chipper"
  | "archimedeanYonta"
  | "devilsTriad"
  | "temporalArchimedea"
  | "roathe";

export interface UpgradeVendorCost {
  amount: number;
  unit: "standing" | "cred" | "plat" | "item" | "ducats";
  /** The currency's name where `unit` is `item`. */
  item?: string;
  /** Baro also charges credits alongside ducats. */
  credits?: number;
  /** The currency's uniqueName where `unit` is `item` or `cred`. */
  currency?: string;
}

interface UpgradeVendorRank {
  level: number | null;
  title: string | null;
}

export interface UpgradeVendorHub {
  region: string | null;
  place: string;
}

/** Exactly one of `name` and `id` is set. */
export interface UpgradeVendorSource {
  name?: string;
  id?: UpgradeVendorId;
  cost?: UpgradeVendorCost;
  rank?: UpgradeVendorRank;
  /** Who in the hub sells it: Hok, Cavalero, Loid. */
  keeper?: string;
  hub?: UpgradeVendorHub;
  /** @wfcd drop locations that are this purchase, not a drop. */
  covers?: string[];
  /** The ExportSyndicates tag whose standing or rank the offer runs on. */
  syndicate?: string;
  nameKey?: string;
}

export interface ComponentEntry {
  uniqueName: string;
  name: string;
  /** `/Lotus/Language/...` key this name came from, for game-language lookup. */
  nameKey?: string | null;
  imageName?: string;
  tradable?: boolean;
  ducats?: number;
  itemCount?: number;
  drops?: DropEntry[];
}

/** Renderer-facing subset of ItemEntry sent via IPC. */
export interface RendererItemEntry {
  /** English. Stays the join key for warframe.market, OCR and by-name lookups. */
  name: string;
  /** Active game language, present only when it differs from `name`. Display only. */
  displayName?: string;
  /** Art is the framed wiki card, so a marketplace thumbnail must not replace it. */
  cardArt?: true;
  category: string;
  imageUrl: string | null;
  isPrime: boolean;
  tradable?: boolean;
  masteryReq: number;
  vaulted: boolean;
  exalted?: boolean;
  masterable?: boolean;
  type: string;
  isBuildComponent: boolean;
  /** DE's name for the built part where `name` is the blueprint that makes it. */
  partName?: string;
  componentOf?: string;
  description: string;
  productCategory: string | null;
  ducats: number | null;
  components: {
    name: string;
    displayName?: string;
    uniqueName: string;
    tradable?: boolean;
    itemCount: number;
    drops: DropEntry[];
  }[];
  drops: DropEntry[];
  mod?: ModFacts;
  arcane?: ArcaneFacts;
  vendors?: UpgradeVendorSource[];
  wikiaUrl?: string | null;
  recipe?: RecipeData;
  /** For blueprint entries: uniqueName of the item this blueprint crafts. */
  buildsProduct?: string;
  /** For blueprint entries: building it does not consume the owned copy. */
  reusableBlueprint?: boolean;
  /** The other form of a weapon that is two at once, such as a gun-blade's melee. */
  otherForm?: string;
}

export interface WorldStateDate {
  $date: { $numberLong: string };
}

interface ActiveMissionRaw {
  Modifier: string;
  MissionType: string;
  Node: string;
  Hard?: boolean;
  Expiry: WorldStateDate;
}

interface VoidTraderRaw {
  Activation: WorldStateDate;
  Expiry: WorldStateDate;
  Node: string;
  Manifest?: { ItemType: string; PrimePrice?: number; RegularPrice?: number }[];
}

interface VaultTraderRaw {
  Activation: WorldStateDate;
  Expiry: WorldStateDate;
  Node: string;
  Manifest?: { ItemType: string; PrimePrice?: number; RegularPrice?: number }[];
}

interface SortieVariantRaw {
  missionType?: string;
  modifierType?: string;
  node?: string;
}

interface SortieRaw {
  _id?: { $oid?: string };
  Activation?: WorldStateDate;
  Expiry?: WorldStateDate;
  Boss?: string;
  Variants?: SortieVariantRaw[];
}

interface LiteSortieMissionRaw {
  missionType?: string;
  node?: string;
}

/** Archon hunt: same envelope as a sortie, with plain missions and no modifiers. */
interface LiteSortieRaw {
  _id?: { $oid?: string };
  Activation?: WorldStateDate;
  Expiry?: WorldStateDate;
  Boss?: string;
  Missions?: LiteSortieMissionRaw[];
}

/** Nightwave act. `Daily` is absent, not false, on weeklies. */
export interface SeasonChallengeRaw {
  _id?: { $oid?: string };
  Daily?: boolean;
  Activation?: WorldStateDate;
  Expiry?: WorldStateDate;
  Challenge?: string;
}

interface SeasonInfoRaw {
  Activation?: WorldStateDate;
  Expiry?: WorldStateDate;
  AffiliationTag?: string;
  Season?: number;
  Phase?: number;
  ActiveChallenges?: SeasonChallengeRaw[];
}

interface TimeWindowRaw {
  Activation?: WorldStateDate;
  Expiry?: WorldStateDate;
}

/** One dated slot of the 1999 calendar; DE ships several event kinds and only
 *  ever fills the field its own type names. */
export interface CalendarEventRaw {
  type?: string;
  challenge?: string;
  reward?: string;
  upgrade?: string;
}

export interface CalendarDayRaw {
  day?: number;
  events?: CalendarEventRaw[];
}

interface CalendarSeasonRaw extends TimeWindowRaw {
  /** Season tag, e.g. "CST_SUMMER". */
  Season?: string;
  Days?: CalendarDayRaw[];
}

interface AlertRewardRaw {
  credits?: number;
  countedItems?: { ItemType?: string; ItemCount?: number }[];
  /** Plain uniqueName strings, quantity one. */
  items?: string[];
}

export interface AlertRaw {
  _id?: { $oid?: string };
  Activation?: WorldStateDate;
  Expiry?: WorldStateDate;
  MissionInfo?: {
    location?: string;
    missionType?: string;
    faction?: string;
    minEnemyLevel?: number;
    maxEnemyLevel?: number;
    missionReward?: AlertRewardRaw;
  };
}

interface SyndicateMissionJobRaw {
  jobType: string;
  rewards: string;
  masteryReq: number;
  minEnemyLevel: number;
  maxEnemyLevel: number;
  xpAmounts: number[];
}

interface SyndicateMissionRaw {
  Activation: WorldStateDate;
  Expiry: WorldStateDate;
  Tag: string;
  Seed: number;
  Nodes?: string[];
  Jobs?: SyndicateMissionJobRaw[];
}

interface InvasionCountedItemRaw {
  ItemType: string;
  ItemCount: number;
}

interface InvasionRewardRaw {
  countedItems?: InvasionCountedItemRaw[];
  credits?: number;
}

interface InvasionRaw {
  _id: { $oid: string };
  Faction: string;
  DefenderFaction: string;
  Node: string;
  Count: number;
  Goal: number;
  LocTag: string;
  Completed: boolean;
  AttackerReward?: InvasionRewardRaw;
  DefenderReward?: InvasionRewardRaw;
  Activation?: WorldStateDate;
}

interface VoidStormRaw {
  Node: string;
  ActiveMissionTier: string;
  Activation?: WorldStateDate;
  Expiry: WorldStateDate;
}

interface DailyDealRaw {
  StoreItem: string;
  Activation?: WorldStateDate;
  Expiry: WorldStateDate;
  Discount?: number;
  OriginalPrice?: number;
  SalePrice?: number;
  AmountTotal?: number;
  AmountSold?: number;
}

/** Server-wide boost. The window field is `ExpiryDate` here, not `Expiry`. */
interface GlobalUpgradeRaw {
  UpgradeType?: string;
  OperationType?: string;
  Value?: number;
  Activation?: WorldStateDate;
  ExpiryDate?: WorldStateDate;
}

export interface WorldStateRaw {
  ActiveMissions?: ActiveMissionRaw[];
  VoidStorms?: VoidStormRaw[];
  VoidTraders?: VoidTraderRaw | VoidTraderRaw[];
  PrimeVaultTraders?: VaultTraderRaw | VaultTraderRaw[];
  Sorties?: SortieRaw | SortieRaw[];
  LiteSorties?: LiteSortieRaw | LiteSortieRaw[];
  SeasonInfo?: SeasonInfoRaw;
  KnownCalendarSeasons?: CalendarSeasonRaw | CalendarSeasonRaw[];
  Alerts?: AlertRaw[];
  Descents?: DescentRaw[];
  EndlessXpChoices?: EndlessXpChoice[];
  EndlessXpSchedule?: EndlessXpScheduleEntry[];
  SyndicateMissions?: SyndicateMissionRaw[];
  Invasions?: InvasionRaw[];
  DailyDeals?: DailyDealRaw[];
  GlobalUpgrades?: GlobalUpgradeRaw[];
}

interface DescentRaw {
  Activation: WorldStateDate;
  Expiry: WorldStateDate;
}

interface EndlessXpChoice {
  Category: string;
  Choices: string[];
}

interface EndlessXpScheduleEntry {
  Activation?: WorldStateDate;
  Expiry?: WorldStateDate;
  CategoryChoices?: EndlessXpChoice[];
}
