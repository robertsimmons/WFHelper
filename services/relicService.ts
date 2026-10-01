import { withScope } from "./logger";
import { normalizeErrorMessage } from "../config/shared/errors";
import { normalizeDucats } from "../config/shared/numeric";
import { normalizeWfmSlug } from "../config/shared/wfm";
import { fallbackNameFromUniqueName } from "../config/shared/displayName";
import { getOverlay } from "./publicExportSource";
import { relicRewardChance, relicRewardRarity } from "./relicRarity";
import {
  localizedNameFields,
  lookupItem,
  lookupItemByNameOrSlug,
  toIconMirrorUrl,
} from "./itemDatabase";

const log = withScope("relicService");

const WFCD_CDN = "https://cdn.warframestat.us/img/";
const QUALITIES = new Set(["Intact", "Exceptional", "Flawless", "Radiant"]);

type RelicQualityKey = "intact" | "exceptional" | "flawless" | "radiant";
const TIERS = new Set(["Lith", "Meso", "Neo", "Axi", "Requiem", "Vanguard"]);

interface RelicReward {
  name: string;
  uniqueName: string | null;
  imageUrl: string | null;
  rarity: string;
  chance: number;
  urlName: string | null;
  wfmId: string | null;
  ducats: number | null;
}

interface RelicQuality {
  uniqueName: string | null;
  rewards: RelicReward[];
}

interface RelicGroup {
  key: string;
  name: string;
  tier: string;
  code: string;
  vaulted: boolean;
  imageUrl: string | null;
  qualities: Record<string, RelicQuality>;
}

interface RelicDatabase {
  groups: Record<string, RelicGroup>;
  byUniqueName: Record<string, { groupKey: string; quality: RelicQualityKey }>;
}

interface RelicRewardItem {
  [key: string]: unknown;
  name: string;
  uniqueName: string | null;
  urlName: string | null;
  rarity: string;
  ducats: number | null;
}

let _db: RelicDatabase | null = null;

export function getRelicRewardItems(): RelicRewardItem[] {
  const seen = new Map<string, RelicRewardItem>();
  for (const group of Object.values(getRelicDatabase().groups)) {
    for (const quality of Object.values(group.qualities)) {
      for (const reward of quality.rewards) {
        if (!reward.name || seen.has(reward.name)) continue;
        const resolved = lookupItemByNameOrSlug(reward.name, reward.urlName);
        const dbEntry =
          resolved?.item || (reward.uniqueName ? lookupItem(reward.uniqueName) : null);
        seen.set(reward.name, {
          name: reward.name,
          uniqueName: resolved?.uniqueName || reward.uniqueName || null,
          urlName: reward.urlName || null,
          rarity: reward.rarity || "Common",
          ducats: reward.ducats ?? dbEntry?.ducats ?? null,
        });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Mirrors inline, unlike itemDatabase's raw builder whose callers mirror later
// via chooseImageUrl. Same shape, different contract - keep the names apart.
function buildMirroredWfcdImageUrl(imageName: string | null | undefined): string | null {
  const trimmed = typeof imageName === "string" ? imageName.trim() : "";
  return trimmed ? toIconMirrorUrl(WFCD_CDN + trimmed) : null;
}

const DE_REFINEMENT: Record<string, RelicQualityKey> = {
  Bronze: "intact",
  Silver: "exceptional",
  Gold: "flawless",
  Platinum: "radiant",
};

interface DeRelicReward {
  rewardName?: string;
  rarity?: string;
  itemCount?: number;
}

function deRelicReward(reward: DeRelicReward, quality: RelicQualityKey): RelicReward | null {
  const uniqueName = reward.rewardName?.replace("/StoreItems/", "/");
  const chance = relicRewardChance(quality, reward.rarity ?? "");
  if (!uniqueName || chance == null) return null;
  const item = lookupItem(uniqueName);
  const baseName = item?.name || fallbackNameFromUniqueName(uniqueName);
  const count = reward.itemCount && reward.itemCount > 1 ? reward.itemCount : 1;
  const name = count > 1 ? `${count}X ${baseName}` : baseName;
  return {
    name,
    ...localizedNameFields(uniqueName, name),
    uniqueName,
    imageUrl: item?.imageUrl ?? null,
    rarity: relicRewardRarity(quality, chance),
    chance,
    urlName: null,
    wfmId: null,
    ducats: normalizeDucats(item?.ducats),
  };
}

/** `@wfcd/items` ships behind the game, so a new Prime's relics come off DE's
 *  own export; a relic the package already knows keeps the package's table. */
function fillFromPublicExport(
  groupsMap: Map<string, RelicGroup>,
  byUniqueNameMap: Map<string, { groupKey: string; quality: RelicQualityKey }>,
): void {
  const relics = getOverlay()?.exports.ExportRelicArcane;
  if (!relics) return;
  let added = 0;
  for (const [uniqueName, relic] of Object.entries(relics)) {
    if (byUniqueNameMap.has(uniqueName) || !uniqueName.includes("/Projections/")) continue;
    const suffix = /(Bronze|Silver|Gold|Platinum)$/.exec(uniqueName)?.[1];
    const quality = suffix ? DE_REFINEMENT[suffix] : undefined;
    const baseName = (relic.name || "").replace(/\s+Relic$/i, "").trim();
    const parts = baseName.split(" ");
    const tier = parts[0];
    if (!quality || parts.length < 2 || !TIERS.has(tier)) continue;
    const rewards = (Array.isArray(relic.relicRewards) ? relic.relicRewards : [])
      .map((reward: DeRelicReward) => deRelicReward(reward, quality))
      .filter((reward): reward is RelicReward => reward !== null);
    if (rewards.length === 0) continue;

    let group = groupsMap.get(baseName);
    if (!group) {
      group = {
        key: baseName,
        name: baseName,
        tier,
        code: parts.slice(1).join(" "),
        vaulted: false,
        imageUrl: null,
        qualities: {},
      };
      groupsMap.set(baseName, group);
    }
    if (group.qualities[quality]) continue;
    group.qualities[quality] = { uniqueName, rewards };
    byUniqueNameMap.set(uniqueName, { groupKey: baseName, quality });
    added += 1;
  }
  if (added > 0) log.info(`[RelicDB] ${added} relic refinements filled from DE's export`);
}

function buildRelicDatabase(): RelicDatabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped @wfcd/items constructor
  let Items: any;
  try {
    Items = require("@wfcd/items");
  } catch (err) {
    log.error("[RelicDB] @wfcd/items not available:", normalizeErrorMessage(err));
    return { groups: {}, byUniqueName: {} };
  }

  const all = new Items();
  const groupsMap = new Map<string, RelicGroup>();
  const byUniqueNameMap = new Map<string, { groupKey: string; quality: RelicQualityKey }>();

  for (const relic of all) {
    if (relic.category !== "Relics") continue;

    const parts = (relic.name || "").split(" ");
    if (parts.length < 3) continue;

    const quality = parts[parts.length - 1];
    if (!QUALITIES.has(quality)) continue;

    const tier = parts[0];
    if (!TIERS.has(tier)) continue;

    const baseName = parts.slice(0, -1).join(" ");
    const code = parts.slice(1, -1).join(" ");

    if (!groupsMap.has(baseName)) {
      groupsMap.set(baseName, {
        key: baseName,
        name: baseName,
        tier,
        code,
        vaulted: Boolean(relic.vaulted),
        imageUrl: null,
        qualities: {},
      });
    }

    const group = groupsMap.get(baseName)!;
    group.vaulted = Boolean(group.vaulted && relic.vaulted);

    if (relic.imageName) {
      if (quality === "Intact" || !group.imageUrl) {
        group.imageUrl = buildMirroredWfcdImageUrl(relic.imageName);
      }
    }

    group.qualities[quality.toLowerCase()] = {
      uniqueName: relic.uniqueName || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped @wfcd/items reward
      rewards: (relic.rewards || []).map((r: any) => {
        const rawSlug = r.item?.warframeMarket?.urlName || r.item?.warframeMarket?.url_name || null;
        return {
          name: r.item?.name || "Unknown",
          ...localizedNameFields(r.item?.uniqueName, r.item?.name || "Unknown"),
          uniqueName: r.item?.uniqueName || null,
          imageUrl: buildMirroredWfcdImageUrl(r.item?.imageName),
          rarity: relicRewardRarity(quality, r.chance || 0, r.rarity || "Common"),
          chance: r.chance || 0,
          urlName: normalizeWfmSlug(rawSlug),
          wfmId: r.item?.warframeMarket?.id || null,
          ducats: normalizeDucats(r.item?.ducats),
        };
      }),
    };

    if (relic.uniqueName) {
      byUniqueNameMap.set(relic.uniqueName, {
        groupKey: baseName,
        quality: quality.toLowerCase() as RelicQualityKey,
      });
    }
  }

  fillFromPublicExport(groupsMap, byUniqueNameMap);

  const groups = Object.fromEntries(groupsMap);
  const byUniqueName = Object.fromEntries(byUniqueNameMap);

  return { groups, byUniqueName };
}

/** A refreshed DE export can name relics the cached build missed. */
export function resetRelicDatabase(): void {
  _db = null;
}

export function getRelicDatabase(): RelicDatabase {
  if (!_db) {
    log.time("[RelicDB] build");
    _db = buildRelicDatabase();
    const n = Object.keys(_db.groups).length;
    log.info(`[RelicDB] ${n} relic groups indexed`);
    log.timeEnd("[RelicDB] build");
  }
  return _db;
}
