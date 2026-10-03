import { activeWindow } from "../format.js";
import { RELIC_ICON_PATHS } from "../relic/relicConstants.js";
import { resolveDropArt } from "./dropPools.js";
import {
  parseOwnedRelics,
  relicGroupForDisplayName,
  relicGroupForUniqueName,
} from "../relic/relicInventory.js";
import { mrInputs, readGroup, referenceTable, rewardUniqueName } from "./relicRead.js";
import { shippedModule } from "./upgrades.js";
import { miscItemCount } from "./vosfor.js";
import { SYNDICATE_RANKS } from "../../data/syndicateRanks.js";
import {
  relicRarity,
  type RelicRarity,
  type RelicRewardStatus,
} from "../../../config/shared/relicMr.js";
import type { ItemDbEntry } from "../../types/inventory.js";
import type { RelicDatabase, RelicGroup, OwnedCounts } from "../../types/relics.js";
import type { SuggestionContext } from "../../types/suggest.js";
import type { WorldState } from "../../types/world.js";

export const AYA_PATH = "/Lotus/Types/Items/MiscItems/SchismKey";
export const STEEL_ESSENCE_PATH = "/Lotus/Types/Items/MiscItems/SteelEssence";
export const RELIC_PACKS_WIKI = "https://wiki.warframe.com/w/Relic_Pack";
export const AYA_WIKI = "https://wiki.warframe.com/w/Aya";

export const STEEL_PACK_COST = 15;
export const SYNDICATE_PACK_COST = 20_000;

/** Every vendor that trades standing for a relic pack. */
export const PACK_SYNDICATES: readonly string[] = [
  "SteelMeridianSyndicate",
  "ArbitersSyndicate",
  "CephalonSudaSyndicate",
  "PerrinSyndicate",
  "RedVeilSyndicate",
  "NewLokaSyndicate",
  "ConclaveSyndicate",
  "CetusSyndicate",
  "SolarisSyndicate",
  "EntratiSyndicate",
];

function parsePool(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const { pool } = raw as Record<string, unknown>;
  return Array.isArray(pool) ? pool.filter((name): name is string => typeof name === "string") : [];
}

const loaded = import.meta.glob("../../data/suggest/relicPacks.json", { eager: true });

/** Relic names a pack of any kind can roll. */
export const RELIC_PACK_POOL: readonly string[] = parsePool(shippedModule(loaded));

export interface RelicPart {
  name: string;
  uniqueName: string | undefined;
  imageUrl: string | null;
  rarity: RelicRarity | null;
  status: RelicRewardStatus | null;
  ownedCount: number | null;
  /** Needed, and the last part its item is missing. */
  finishes: boolean;
}

export interface RelicPayout {
  key: string;
  tier: string;
  name: string;
  imageUrl: string | null;
  /** Copies held, every refinement together. */
  held: number;
  /** Every drop, needed first: what finishes an item, then the rarest. */
  parts: RelicPart[];
  needed: number;
  /** `relicMr`'s value: a point per needed part, one more for each that finishes. */
  value: number;
}

export interface VarziaRelic extends RelicPayout {
  aya: number | null;
}

export interface SyndicateStanding {
  tag: string;
  name: string;
  standing: number;
}

export interface RelicPacksSummary {
  steelEssence: number | null;
  /** The pack vendor the player has the most standing with; null while no
   *  inventory is read or none of them has a row. */
  syndicate: SyndicateStanding | null;
  /** Distinct needed parts across pool relics none of which are held; null
   *  while no inventory is read. */
  poolParts: number | null;
  /** Pool relics paying a needed part, most parts first. */
  pool: RelicPayout[];
  aya: number | null;
  /** Null while Varzia is away. */
  varziaExpiry: string | null;
  /** Relics Varzia sells that pay a needed part and are not held, best first. */
  ayaPicks: VarziaRelic[];
  /** Every relic Varzia sells, payers first. */
  varzia: VarziaRelic[];
}

type MrSources = Pick<SuggestionContext, "inventory" | "itemDb" | "mastery">;
type ReadPayout = (group: RelicGroup) => RelicPayout | null;

const RARITY_RANK: Record<RelicRarity, number> = { common: 0, uncommon: 1, rare: 2 };

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

function partOrder(a: RelicPart, b: RelicPart): number {
  const rank = (part: RelicPart): number => (part.rarity ? RARITY_RANK[part.rarity] : -1);
  return (
    Number(b.status === "needed") - Number(a.status === "needed") ||
    Number(b.finishes) - Number(a.finishes) ||
    rank(b) - rank(a) ||
    byName(a, b)
  );
}

export function payoutReader(sources: MrSources, owned: OwnedCounts): ReadPayout {
  const inputs = mrInputs(sources);
  const { itemDb } = sources;
  return (group) => {
    const table = referenceTable(group);
    const read = readGroup(group, itemDb, inputs);
    if (!table || !read) return null;
    const seen = new Set<string>();
    const parts: RelicPart[] = [];
    table.rewards.forEach((reward, index) => {
      if (seen.has(reward.name)) return;
      seen.add(reward.name);
      const mr = read.mr.rewards[index];
      parts.push({
        name: reward.name,
        uniqueName: rewardUniqueName(reward, itemDb),
        imageUrl: reward.imageUrl ?? null,
        rarity: relicRarity(table.quality, reward),
        status: mr?.status ?? null,
        ownedCount: mr?.ownedCount ?? null,
        finishes: mr?.finishes ?? false,
      });
    });
    const counts = owned[group.key];
    return {
      key: group.key,
      name: group.name,
      tier: group.tier,
      imageUrl: group.imageUrl ?? null,
      held: counts ? counts.intact + counts.exceptional + counts.flawless + counts.radiant : 0,
      parts: parts.sort(partOrder),
      needed: read.mr.needed,
      value: read.mr.value,
    };
  };
}

function poolGroup(db: RelicDatabase, name: string): RelicGroup | null {
  return db.groups[name] ?? relicGroupForDisplayName(db, name);
}

/** Distinct needed parts a pack could land, counted only off relics the player
 *  holds none of: a held one is already a crack away. */
export function poolPartCount(payouts: readonly RelicPayout[]): number {
  const parts = new Set<string>();
  for (const payout of payouts) {
    if (payout.held > 0) continue;
    for (const part of payout.parts) if (part.status === "needed") parts.add(part.name);
  }
  return parts.size;
}

function byPartsPaid(a: RelicPayout, b: RelicPayout): number {
  return b.needed - a.needed || b.value - a.value || a.held - b.held || byName(a, b);
}

/** Payers first, by what they are worth, so the best buy leads. */
function byWorth(a: RelicPayout, b: RelicPayout): number {
  return (
    Number(b.needed > 0) - Number(a.needed > 0) ||
    b.value - a.value ||
    b.needed - a.needed ||
    byName(a, b)
  );
}

/** The pack vendor with the most standing; ties go to the earlier vendor. */
export function bestPackSyndicate(
  inventory: SuggestionContext["inventory"],
): SyndicateStanding | null {
  const rows = inventory?.Affiliations;
  if (!Array.isArray(rows)) return null;
  let best: { tag: string; standing: number } | null = null;
  for (const tag of PACK_SYNDICATES) {
    const row = rows.find(
      (entry): entry is { Tag: string; Standing?: unknown } =>
        !!entry && typeof entry === "object" && (entry as { Tag?: unknown }).Tag === tag,
    );
    if (!row) continue;
    const standing = typeof row.Standing === "number" ? row.Standing : 0;
    if (!best || standing > best.standing) best = { tag, standing };
  }
  const found = best;
  if (!found) return null;
  const name = SYNDICATE_RANKS.find((meta) => meta.tag === found.tag)?.name ?? found.tag;
  return { ...found, name };
}

const PROJECTION = "/Projections/";

/** What Varzia has on the shelf right now, as relics. */
export function varziaStock(
  world: WorldState | null,
  db: RelicDatabase,
  nowMs: number,
  read: ReadPayout,
): { expiry: string | null; relics: VarziaRelic[] } {
  const trader = world?.vaultTrader;
  if (!trader || !activeWindow(trader.activation, trader.expiry, nowMs)) {
    return { expiry: null, relics: [] };
  }
  const seen = new Set<string>();
  const relics: VarziaRelic[] = [];
  for (const entry of trader.inventory ?? []) {
    const uniqueName = entry.uniqueName ?? "";
    if (!uniqueName.includes(PROJECTION)) continue;
    const group =
      relicGroupForUniqueName(db, uniqueName) ??
      (entry.item ? relicGroupForDisplayName(db, entry.item) : null);
    if (!group || seen.has(group.key)) continue;
    seen.add(group.key);
    const payout = read(group);
    if (payout) relics.push({ ...payout, aya: typeof entry.aya === "number" ? entry.aya : null });
  }
  return { expiry: trader.expiry ?? null, relics: relics.sort(byWorth) };
}

export function relicPacksSummary(
  input: MrSources & Pick<SuggestionContext, "relicDb" | "world" | "nowMs">,
  pool: readonly string[] = RELIC_PACK_POOL,
): RelicPacksSummary {
  const { inventory, relicDb, world, nowMs } = input;
  const summary: RelicPacksSummary = {
    steelEssence: miscItemCount(inventory, STEEL_ESSENCE_PATH),
    syndicate: bestPackSyndicate(inventory),
    poolParts: null,
    pool: [],
    aya: miscItemCount(inventory, AYA_PATH),
    varziaExpiry: null,
    ayaPicks: [],
    varzia: [],
  };
  const trader = world?.vaultTrader;
  if (trader && activeWindow(trader.activation, trader.expiry, nowMs)) {
    summary.varziaExpiry = trader.expiry ?? null;
  }
  // Without a shelf to read every part looks needed, which says nothing.
  if (!inventory || !relicDb) return summary;

  const read = payoutReader(input, parseOwnedRelics(inventory, relicDb));
  const payouts = pool
    .map((name) => poolGroup(relicDb, name))
    .filter((group): group is RelicGroup => group !== null)
    .map(read)
    .filter((payout): payout is RelicPayout => payout !== null);
  summary.poolParts = poolPartCount(payouts);
  summary.pool = payouts.filter((payout) => payout.needed > 0).sort(byPartsPaid);

  const stock = varziaStock(world, relicDb, nowMs, read);
  summary.varzia = stock.relics;
  summary.ayaPicks = stock.relics.filter((relic) => relic.needed > 0 && relic.held === 0);
  return summary;
}

export function relicArt(row: RelicPayout): string | null {
  return (
    row.imageUrl ?? RELIC_ICON_PATHS[row.tier.toLowerCase()] ?? RELIC_ICON_PATHS["default"] ?? null
  );
}

export function partArt(itemDb: Record<string, ItemDbEntry>, part: RelicPart): string | null {
  return resolveDropArt(itemDb, part.name, part.uniqueName)?.imageUrl ?? part.imageUrl;
}
