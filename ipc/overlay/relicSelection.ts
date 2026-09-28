import { normalizeDucats, toFiniteOr, clampNumber } from "../../config/shared/numeric";
import { normalizeErrorMessage } from "../../config/shared/errors";
import { RELIC_RECOMMENDATIONS, RELIC_PLANNER_TRIGGER } from "../../config/shared/ipcChannels";
import { collectRelicInventoryCounts } from "../../config/shared/relicCounts";
import { getWindowsOcrHealth } from "../../services/ocrServer";
import { rewardOcrOnnxAvailable } from "../../services/rewardOcrOnnx";
import { normalizeOcrPhrase } from "../../config/shared/ocrPhrase";
import { normalizeWfmSlugKey } from "../../config/shared/wfm";
import { RELIC_MISSION_TIER_CACHE_TTL_MS } from "../../config/runtime/cacheConfig";
import { aggregateComponentOwnership } from "../../config/shared/componentOwnership";
import { pendingBuildCounts, withoutFoundryPending } from "../../config/shared/foundryPending";
import type { MasteryStatus } from "../../config/shared/masteryTypes";
import {
  masteredKeys,
  relicAdvice,
  relicMr,
  relicRarity,
  type RelicAdvice,
  type RelicMr,
  type RelicMrItem,
} from "../../config/shared/relicMr";
import * as itemDatabase from "../../services/itemDatabase";
import { computeMasteryProgress } from "../../services/masteryHelper";

const RECOMMENDATION_SQUAD_SIZE = 4;
/** How long computed recommendations stay cached before a full recompute. */
const RECOMMENDATION_CACHE_TTL_MS = 10_000;
/** Minimum gap between two EE.log trigger events to avoid double-firing. */
const MIN_EELOG_TRIGGER_GAP_MS = 900;
/** Max time for the OCR era-detection pass before falling back to desktop filter hint. */
const ERA_DETECTION_TIMEOUT_MS = 1500;
const ERA_DETECTION_RETRY_DELAY_MS = 700;
// The picker is not painted when the EE.log trigger lands, and reading it early
// costs a whole OCR pass that finds nothing plus the retry delay above. Waiting
// a little first is cheaper than the miss it avoids.
const ERA_DETECTION_START_DELAY_MS = 100;
/** Suppress overlay reopen for this long after an explicit close to prevent flicker. */
const REOPEN_SUPPRESS_AFTER_CLOSE_MS = 3_000;

/** Safety net if the InitMapping close never arrives; must outlast a long relic browse. */
const OVERLAY_AUTO_HIDE_SUCCESS_MS = 120_000;
/** Auto-hide after a detection failure - keep visible briefly so the user sees the state. */
const OVERLAY_AUTO_HIDE_FAILURE_MS = 4_500;
/** Hard ceiling for the detecting phase before giving up and hiding. */
const OVERLAY_AUTO_HIDE_DETECTING_MAX_MS = 20_000;

const QUALITY_ORDER: readonly (keyof OwnedCountRow)[] = Object.freeze([
  "radiant",
  "flawless",
  "exceptional",
  "intact",
]);
const REFERENCE_ORDER: readonly (keyof OwnedCountRow)[] = Object.freeze(
  [...QUALITY_ORDER].reverse(),
);
const QUALITY_LABEL: Readonly<Record<keyof OwnedCountRow, string>> = Object.freeze({
  intact: "Intact",
  exceptional: "Exceptional",
  flawless: "Flawless",
  radiant: "Radiant",
});

type Reward = {
  name?: string | null;
  uniqueName?: string | null;
  urlName?: string | null;
  chance?: number;
  ducats?: number | null;
  rarity?: string | null;
};

type QualityData = {
  rewards?: Reward[];
};

type RelicGroup = {
  key: string;
  name: string;
  tier?: string;
  vaulted?: boolean;
  qualities?: Record<string, QualityData | undefined>;
};

type OwnedCountRow = {
  intact: number;
  exceptional: number;
  flawless: number;
  radiant: number;
};

type EraDetection = {
  era?: string | null;
  confidence?: number;
  textPreview?: string;
  elapsedMs?: number;
  sourceType?: string | null;
  sourceName?: string | null;
  sourceDisplayId?: string | null;
  sourceId?: string | null;
  candidateId?: string | null;
};

type RelicQuality = keyof OwnedCountRow;

type PricedRow = {
  label: string;
  relicName: string;
  quality: RelicQuality;
  count: number;
  platEv: number | null;
  ducatEv: number | null;
  vaulted: boolean;
};

type RecommendationRow = PricedRow & {
  /** Refinement worth cracking for this row's goal. */
  advice: RelicQuality | null;
};

type MrRecommendationRow = RecommendationRow & {
  mrNeeded: number;
  /** Display names of the items a needed part would complete. */
  mrFinishes: string[];
  mrValue: number;
};

type Recommendations = {
  rows: RecommendationRow[];
  mrRows: MrRecommendationRow[];
  totalOwnedCount: number;
};

type Pricing = {
  squadSize: number;
  platinum: (slug: string) => number | null;
  ducats: (slug: string) => number | null;
};

type MasterySource = {
  lookupItem: (uniqueName: string) => RelicMrItem | null;
  resolveReward: (name: string | null, urlName: string | null) => string | null;
  masteryItems: (inventory: Record<string, unknown>) => readonly {
    uniqueName?: string | null;
    name?: string | null;
    status?: MasteryStatus | null;
  }[];
  isReusableBlueprint: (uniqueName: string) => boolean;
  buildsProduct: (uniqueName: string) => string | null;
};

type MrInputs = {
  itemDb: Readonly<Record<string, RelicMrItem>>;
  ownership: Map<string, number>;
  pending: Map<string, number>;
  mastered: ReadonlySet<string>;
};

const ITEM_DATABASE_MASTERY: MasterySource = {
  lookupItem: (uniqueName) => {
    const entry = itemDatabase.lookupItem(uniqueName);
    return entry ? { ...entry, ...itemDatabase.localizedNameFields(uniqueName, entry.name) } : null;
  },
  resolveReward: (name, urlName) =>
    itemDatabase.lookupItemByNameOrSlug(name, urlName)?.uniqueName ?? null,
  masteryItems: (inventory) => computeMasteryProgress(inventory).items,
  isReusableBlueprint: itemDatabase.isReusableBlueprint,
  buildsProduct: itemDatabase.buildsProductOf,
};

type OverlayRecommendationControllerOptions = {
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  ctx: {
    overlaySettings: import("../../config/runtime/overlaySettings").OverlaySettings;
    currentInventoryData: Record<string, unknown> | null;
    overlayDismissedUntilMs?: number;
    activeFissureTier?: string | null;
  };
  windows: {
    createOverlayWindow: () => void;
    clearOverlayAutoHideTimer: () => void;
    scheduleOverlayAutoHide: (delayMs: number) => void;
    sendOverlayEvent: (channel: string, payload?: unknown) => void;
    positionOverlayWindow: (meta: Record<string, unknown> | null) => void;
    getAnchorMeta: () => Record<string, unknown> | null;
    setAnchorMeta: (meta: Record<string, unknown> | null) => void;
  };
  relicService: {
    getRelicDatabase: () => {
      groups: Record<string, RelicGroup>;
      byUniqueName: Record<string, { groupKey: string; quality: keyof OwnedCountRow }>;
    };
  };
  rewardScanner: {
    captureSourceMeta?: (options?: { preferredDisplayId?: string | null }) => Promise<{
      sourceType?: string | null;
      sourceDisplayId?: string | null;
      sourceName?: string | null;
      sourceId?: string | null;
    } | null>;
    detectRelicSelectionEra?: (options?: {
      timeoutMs?: number;
      preferredDisplayId?: string | null;
      labelOnly?: boolean;
    }) => Promise<EraDetection>;
  };
  wfmStatsPrice: {
    getCachedPriceBySlug?: (slug: string) => number | null;
  };
  warframeStatus?: {
    getStatus: (options?: { force?: boolean }) => Promise<{
      isOpen: boolean;
      isFocused: boolean;
      focusedProcessName?: string | null;
      focusedDisplayId?: string | null;
    }>;
  };
  fs: typeof import("node:fs");
  cacheFilePath: string;
  mastery?: MasterySource;
  /** Overrides the wait before the first era capture. Tests drive real timers. */
  eraStartDelayMs?: number;
};

function eraOcrUnavailable(): boolean {
  return !getWindowsOcrHealth().available && !rewardOcrOnnxAvailable();
}

function normalizeEra(value: unknown): string | null {
  const low = String(value || "")
    .trim()
    .toLowerCase();
  if (!low) return null;
  if (low.includes("requiem")) return "requiem";
  if (low.includes("lith")) return "lith";
  if (low.includes("meso")) return "meso";
  if (low.includes("neo")) return "neo";
  if (low.includes("axi")) return "axi";
  if (low.includes("omnia")) return "omnia";
  return null;
}

// Built from the row label we composed, so it is language-independent even
// though the rest of the overlay is translated. Short labels are dropped
// because a two-word fragment can occur in the game's own relic screen.
function overlayRowSignature(label: string): string | null {
  const normalized = normalizeOcrPhrase(label);
  return normalized.split(" ").length >= 3 ? normalized : null;
}

// EE.log activeMissionTag values -> relic era; VoidT6 (omnia) accepts any era.
const VOID_TAG_ERAS: Readonly<Record<string, string>> = Object.freeze({
  VOIDT1: "lith",
  VOIDT2: "meso",
  VOIDT3: "neo",
  VOIDT4: "axi",
  VOIDT5: "requiem",
  VOIDT6: "omnia",
});

function qualityCountsRow(): OwnedCountRow {
  return {
    intact: 0,
    exceptional: 0,
    flawless: 0,
    radiant: 0,
  };
}

function parseOwnedRelicCounts(
  inventoryData: Record<string, unknown> | null,
  byUniqueName: Record<string, { groupKey: string; quality: keyof OwnedCountRow }>,
): Record<string, OwnedCountRow> {
  const owned: Record<string, OwnedCountRow> = {};
  if (!inventoryData) return owned;

  const countedByItemType = collectRelicInventoryCounts(
    inventoryData,
    (itemType) => byUniqueName[itemType] !== undefined,
  );

  for (const [itemType, count] of countedByItemType) {
    const info = byUniqueName[itemType];
    if (!info) continue;

    if (!owned[info.groupKey]) {
      owned[info.groupKey] = qualityCountsRow();
    }
    owned[info.groupKey][info.quality] += count;
  }

  return owned;
}

function computeSquadExpected(
  rewards: Array<{ chance: number }>,
  values: Array<number | null>,
  squadSize: number,
): number {
  const items = rewards.map((reward, index) => ({
    prob: clampNumber(toFiniteOr(reward?.chance, 0) / 100, 0, 1),
    value: values[index] ?? 0,
  }));

  if (squadSize <= 1) {
    return items.reduce((sum, item) => sum + item.prob * item.value, 0);
  }

  const sorted = [...items].sort((a, b) => a.value - b.value);
  const grouped: Array<{ value: number; prob: number }> = [];
  for (const item of sorted) {
    const last = grouped[grouped.length - 1];
    if (last && last.value === item.value) {
      last.prob += item.prob;
    } else {
      grouped.push({ value: item.value, prob: item.prob });
    }
  }

  let ev = 0;
  let cdfPrev = 0;
  for (const groupedItem of grouped) {
    const cdfCur = Math.min(1, cdfPrev + groupedItem.prob);
    ev += groupedItem.value * (Math.pow(cdfCur, squadSize) - Math.pow(cdfPrev, squadSize));
    cdfPrev = cdfCur;
  }
  return ev;
}

// Reward-card pricing accepts snapshot medians up to this old; the planner's
// EV ranking deliberately uses any age.
const SNAPSHOT_PRICE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function loadPersistedCacheMaps(
  fs: typeof import("node:fs"),
  cacheFilePath: string,
): { prices: Map<string, number>; ducats: Map<string, number> } {
  const prices = new Map<string, number>();
  const ducats = new Map<string, number>();

  try {
    if (!fs.existsSync(cacheFilePath)) return { prices, ducats };
    const raw = fs.readFileSync(cacheFilePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { prices, ducats };

    // Snapshot format has a nested { prices: {...}, meta: {...} } structure.
    // Legacy flat format had slug entries at the root level.
    const priceRoot = (parsed as Record<string, unknown>).prices;
    const priceEntries: Record<string, unknown> =
      priceRoot !== null && typeof priceRoot === "object" && !Array.isArray(priceRoot)
        ? (priceRoot as Record<string, unknown>)
        : (parsed as Record<string, unknown>);

    for (const [slug, entry] of Object.entries(priceEntries)) {
      if (!entry || typeof entry !== "object") continue;
      const status = String((entry as { status?: unknown }).status || "ok").toLowerCase();
      if (status !== "ok") continue;
      const normalized = normalizeWfmSlugKey(slug);
      if (!normalized) continue;
      const median = toFiniteOr((entry as { median?: unknown }).median, NaN);
      if (!Number.isFinite(median) || median <= 0) continue;
      prices.set(normalized, median);
    }

    // Snapshot also carries order summaries. Use them as a snapshot-only fallback
    // when the median map does not have an entry for a reward slug.
    const orderSummaries = (parsed as Record<string, unknown>).orderSummaries;
    if (
      orderSummaries !== null &&
      typeof orderSummaries === "object" &&
      !Array.isArray(orderSummaries)
    ) {
      for (const [slug, entry] of Object.entries(orderSummaries as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object") continue;
        const status = String((entry as { status?: unknown }).status || "ok").toLowerCase();
        if (status !== "ok") continue;
        const normalized = normalizeWfmSlugKey(slug);
        if (!normalized || prices.has(normalized)) continue;

        const record = entry as { wts?: unknown; wtb?: unknown };
        const sellPrice = toFiniteOr(record.wts, NaN);
        const buyPrice = toFiniteOr(record.wtb, NaN);
        const snapshotPrice =
          Number.isFinite(sellPrice) && sellPrice > 0
            ? sellPrice
            : Number.isFinite(buyPrice) && buyPrice > 0
              ? buyPrice
              : NaN;

        if (!Number.isFinite(snapshotPrice) || snapshotPrice <= 0) continue;
        prices.set(normalized, snapshotPrice);
      }
    }

    // Extract ducat values from snapshot meta (only available in snapshot format).
    const meta = (parsed as Record<string, unknown>).meta;
    if (meta !== null && typeof meta === "object" && !Array.isArray(meta)) {
      for (const [slug, entry] of Object.entries(meta as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object") continue;
        const ducatValue = normalizeDucats((entry as { ducats?: unknown }).ducats);
        if (ducatValue == null || ducatValue <= 0) continue;
        ducats.set(normalizeWfmSlugKey(slug), ducatValue);
      }
    }
  } catch {
    // Corrupt/unreadable price-cache file - return whatever parsed so far.
    return { prices, ducats };
  }

  return { prices, ducats };
}

function getCacheFileMtimeMs(fs: typeof import("node:fs"), cacheFilePath: string): number {
  try {
    if (!fs.existsSync(cacheFilePath)) return 0;
    const stat = fs.statSync(cacheFilePath);
    const mtimeMs = toFiniteOr((stat as { mtimeMs?: number }).mtimeMs, 0);
    return Number.isFinite(mtimeMs) && mtimeMs > 0 ? mtimeMs : 0;
  } catch {
    // Missing/unstattable cache file - treat as mtime 0 (forces a refresh).
    return 0;
  }
}

function rewardPlatinum(reward: Reward, pricing: Pricing): number | null {
  const slug = normalizeWfmSlugKey(reward?.urlName);
  return slug ? pricing.platinum(slug) : null;
}

function rewardDucats(reward: Reward, pricing: Pricing): number | null {
  // @wfcd/items rarely ships ducat values; fall back to snapshot meta ducats.
  const rewardDucats = normalizeDucats(reward?.ducats);
  if (rewardDucats != null && rewardDucats > 0) return rewardDucats;
  const slug = normalizeWfmSlugKey(reward?.urlName);
  return slug ? pricing.ducats(slug) : null;
}

function priceQuality(
  group: RelicGroup,
  quality: RelicQuality,
  count: number,
  pricing: Pricing,
): PricedRow | null {
  const rewards = group.qualities?.[quality]?.rewards || [];
  if (count <= 0 || rewards.length === 0) return null;

  const chances = rewards.map((reward) => ({
    chance: clampNumber(toFiniteOr(reward?.chance, 0), 0, 100),
  }));
  const platValues = rewards.map((reward) => rewardPlatinum(reward, pricing));
  const ducatValues = rewards.map((reward) => rewardDucats(reward, pricing));

  const hasAnyPlat = platValues.some((value) => value != null);
  const hasAnyDucat = ducatValues.some((value) => value != null);
  // Show relics even when neither price nor ducat data is available in the snapshot.
  // Null EVs display as "-p / -d" in the overlay instead of pretending the value is 0.

  return {
    label: `${count}x ${group.name} ${QUALITY_LABEL[quality]}`,
    relicName: group.name,
    quality,
    count,
    platEv: hasAnyPlat ? computeSquadExpected(chances, platValues, pricing.squadSize) : null,
    ducatEv: hasAnyDucat ? computeSquadExpected(chances, ducatValues, pricing.squadSize) : null,
    vaulted: Boolean(group.vaulted),
  };
}

function pickBestOwnedQuality(
  group: RelicGroup,
  ownedRow: OwnedCountRow,
  pricing: Pricing,
): PricedRow | null {
  let best: PricedRow | null = null;

  for (const quality of QUALITY_ORDER) {
    const row = priceQuality(group, quality, ownedRow[quality] || 0, pricing);
    if (!row) continue;

    if (!best) {
      best = row;
      continue;
    }

    const bestPlat = best.platEv ?? -1;
    const nextPlat = row.platEv ?? -1;
    if (nextPlat !== bestPlat) {
      if (nextPlat > bestPlat) best = row;
      continue;
    }

    const bestDucat = best.ducatEv ?? -1;
    const nextDucat = row.ducatEv ?? -1;
    if (nextDucat > bestDucat) best = row;
  }

  return best;
}

/** The advised grade when it is held, else the best grade held. */
function pickMrQuality(
  group: RelicGroup,
  ownedRow: OwnedCountRow,
  advised: RelicQuality,
): RelicQuality | null {
  const usable = (quality: RelicQuality) =>
    (ownedRow[quality] || 0) > 0 && (group.qualities?.[quality]?.rewards?.length ?? 0) > 0;
  if (usable(advised)) return advised;
  return QUALITY_ORDER.find(usable) ?? null;
}

function buildMrInputs(inventory: Record<string, unknown> | null, source: MasterySource): MrInputs {
  const itemDb = new Proxy<Record<string, RelicMrItem>>(
    {},
    {
      get: (_target, key) =>
        typeof key === "string" ? (source.lookupItem(key) ?? undefined) : undefined,
    },
  );
  if (!inventory) {
    return { itemDb, ownership: new Map(), pending: new Map(), mastered: new Set() };
  }
  return {
    itemDb,
    ownership: aggregateComponentOwnership(
      withoutFoundryPending(inventory, source.isReusableBlueprint),
    ),
    pending: pendingBuildCounts(inventory.PendingRecipes, source.buildsProduct),
    mastered: masteredKeys(source.masteryItems(inventory)),
  };
}

function readMr(rewards: readonly Reward[], inputs: MrInputs, source: MasterySource): RelicMr {
  return relicMr({
    rewards: rewards.map((reward) => ({
      name: reward.name || reward.urlName || reward.uniqueName || "",
      uniqueName:
        source.resolveReward(reward.name ?? null, reward.urlName ?? null) ?? reward.uniqueName,
    })),
    ...inputs,
  });
}

/** Every refinement names the same drops, so any one table lists them all. */
function groupAdvice(
  group: RelicGroup,
  inputs: MrInputs,
  source: MasterySource,
  pricing: Pricing,
): RelicAdvice | null {
  const quality = REFERENCE_ORDER.find(
    (candidate) => (group.qualities?.[candidate]?.rewards?.length ?? 0) > 0,
  );
  const rewards = quality ? (group.qualities?.[quality]?.rewards ?? []) : [];
  if (!quality || rewards.length === 0) return null;
  const mr = readMr(rewards, inputs, source);
  return relicAdvice(
    rewards.map((reward, index) => ({
      rarity: relicRarity(quality, {
        chance: toFiniteOr(reward?.chance, 0),
        rarity: reward?.rarity,
      }),
      platinum: rewardPlatinum(reward, pricing),
      ducats: rewardDucats(reward, pricing),
      status: mr.rewards[index]?.status ?? null,
    })),
  );
}

function compareValueRows(a: PricedRow, b: PricedRow): number {
  const aPlat = a.platEv ?? -1;
  const bPlat = b.platEv ?? -1;
  if (bPlat !== aPlat) return bPlat - aPlat;

  const aDucat = a.ducatEv ?? -1;
  const bDucat = b.ducatEv ?? -1;
  if (bDucat !== aDucat) return bDucat - aDucat;

  return a.label.localeCompare(b.label);
}

function compareMrRows(a: MrRecommendationRow, b: MrRecommendationRow): number {
  if (b.mrValue !== a.mrValue) return b.mrValue - a.mrValue;
  const aPlat = a.platEv ?? -1;
  const bPlat = b.platEv ?? -1;
  if (bPlat !== aPlat) return bPlat - aPlat;
  return a.relicName.localeCompare(b.relicName);
}

function toStableOwnedFingerprint(owned: Record<string, OwnedCountRow>): string {
  const rows = Object.entries(owned)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([groupKey, counts]) =>
        `${groupKey}:${counts.intact}|${counts.exceptional}|${counts.flawless}|${counts.radiant}`,
    );
  return rows.join(";");
}

export function createRelicSelectionController(options: OverlayRecommendationControllerOptions) {
  const { log, ctx, windows, relicService, rewardScanner, wfmStatsPrice, fs, cacheFilePath } =
    options;
  const eraStartDelayMs = options.eraStartDelayMs ?? ERA_DETECTION_START_DELAY_MS;
  const masterySource = options.mastery ?? ITEM_DATABASE_MASTERY;

  let inFlight = false;
  let activeScanToken = 0;
  let lastEelogTriggerAt = 0;
  let lastKnownGameDisplayId: string | null = null;
  let desktopSquadSize: number = RECOMMENDATION_SQUAD_SIZE;
  let desktopTierHint: string | null = null;
  // Reuse confident era OCR across endless rotations until the mission cache expires.
  let activeMissionTier: string | null = null;
  let activeMissionTierSetAt = 0;
  // The mission tag overrides OCR because omnia tiles can look like Lith.
  // It lasts through long endless runs and clears on the next non-fissure mission.
  let logMissionTier: string | null = null;
  // Signatures of the rows currently painted on the overlay. The era capture
  // can still catch our own panel, and reading it back re-confirms whatever
  // era produced those rows, so a wrong era would never expire. They outlive
  // the menu-closed event on purpose: a real log self-read 2s after it.
  let overlayRowSignatures: string[] = [];
  let mrInputsCache: { inventory: Record<string, unknown> | null; inputs: MrInputs } | null = null;
  let cache: {
    key: string;
    inventory: Record<string, unknown> | null;
    result: Recommendations;
    ts: number;
  } | null = null;
  let persistedPriceMedianCache: {
    mtimeMs: number;
    prices: Map<string, number>;
    ducats: Map<string, number>;
  } | null = null;

  function getPersistedCacheMaps(): { prices: Map<string, number>; ducats: Map<string, number> } {
    const mtimeMs = getCacheFileMtimeMs(fs, cacheFilePath);
    if (persistedPriceMedianCache && persistedPriceMedianCache.mtimeMs === mtimeMs) {
      return { prices: persistedPriceMedianCache.prices, ducats: persistedPriceMedianCache.ducats };
    }

    const { prices, ducats } = loadPersistedCacheMaps(fs, cacheFilePath);
    persistedPriceMedianCache = { mtimeMs, prices, ducats };
    return { prices, ducats };
  }

  // Instant reward-card pricing from the same on-disk snapshot the planner
  // reads; null (missing slug or file too old) sends the caller to live WFM.
  function getSnapshotPrice(slugInput: string): number | null {
    const normalized = normalizeWfmSlugKey(slugInput);
    if (!normalized) return null;
    const mtimeMs = getCacheFileMtimeMs(fs, cacheFilePath);
    if (!mtimeMs || Date.now() - mtimeMs > SNAPSHOT_PRICE_MAX_AGE_MS) return null;
    const { prices } = getPersistedCacheMaps();
    return prices.get(normalized) ?? null;
  }

  function buildRecommendations(era: string | null): Recommendations {
    const db = relicService.getRelicDatabase();
    const groups = Object.values(db.groups || {}) as RelicGroup[];
    const owned = parseOwnedRelicCounts(ctx.currentInventoryData, db.byUniqueName || {});

    const inventory = ctx.currentInventoryData;
    const cacheKey = `${era || "all"}|${toStableOwnedFingerprint(owned)}`;
    if (
      cache &&
      cache.key === cacheKey &&
      cache.inventory === inventory &&
      Date.now() - cache.ts < RECOMMENDATION_CACHE_TTL_MS
    ) {
      return cache.result;
    }

    if (!mrInputsCache || mrInputsCache.inventory !== inventory) {
      mrInputsCache = { inventory, inputs: buildMrInputs(inventory, masterySource) };
    }
    const mrInputs = mrInputsCache.inputs;

    const { prices: persistedPrices, ducats: persistedDucats } = getPersistedCacheMaps();

    const getPrice = (slug: string): number | null => {
      const normalized = normalizeWfmSlugKey(slug);
      if (!normalized) return null;

      if (persistedPrices.has(normalized)) {
        return persistedPrices.get(normalized) || null;
      }

      if (typeof wfmStatsPrice.getCachedPriceBySlug === "function") {
        const cached = wfmStatsPrice.getCachedPriceBySlug(normalized);
        if (typeof cached === "number" && Number.isFinite(cached) && cached > 0) {
          return cached;
        }
      }

      return null;
    };

    const getDucats = (slug: string): number | null => {
      const normalized = normalizeWfmSlugKey(slug);
      if (!normalized) return null;
      return persistedDucats.get(normalized) ?? null;
    };

    const pricing: Pricing = {
      squadSize: desktopSquadSize,
      platinum: getPrice,
      ducats: getDucats,
    };

    let totalOwnedCount = 0;
    const rows: RecommendationRow[] = [];
    const mrRows: MrRecommendationRow[] = [];
    // omnia fissures accept every era - no filter
    const eraFilter = era === "omnia" ? null : era;
    for (const group of groups) {
      const groupEra = normalizeEra(group.tier);
      if (eraFilter && groupEra !== eraFilter) continue;

      const ownedRow = owned[group.key];
      if (!ownedRow) continue;

      const groupTotal =
        (ownedRow.intact || 0) +
        (ownedRow.exceptional || 0) +
        (ownedRow.flawless || 0) +
        (ownedRow.radiant || 0);
      totalOwnedCount += groupTotal;

      const advice = groupAdvice(group, mrInputs, masterySource, pricing);
      const best = pickBestOwnedQuality(group, ownedRow, pricing);
      if (best) rows.push({ ...best, advice: advice?.platinum ?? null });

      const mrQuality = advice?.mr ? pickMrQuality(group, ownedRow, advice.mr) : null;
      const mrPriced = mrQuality
        ? priceQuality(group, mrQuality, ownedRow[mrQuality] || 0, pricing)
        : null;
      if (!mrPriced || !mrQuality) continue;
      const mr = readMr(group.qualities?.[mrQuality]?.rewards ?? [], mrInputs, masterySource);
      if (mr.needed <= 0) continue;
      mrRows.push({
        ...mrPriced,
        advice: advice?.mr ?? null,
        mrNeeded: mr.needed,
        mrFinishes: mr.finishes,
        mrValue: mr.value,
      });
    }

    rows.sort(compareValueRows);
    mrRows.sort(compareMrRows);

    const result: Recommendations = { rows, mrRows, totalOwnedCount };
    cache = { key: cacheKey, inventory, result, ts: Date.now() };
    return result;
  }

  function rememberOverlayRows(rows: readonly PricedRow[]): void {
    overlayRowSignatures = rows
      .map((row) => overlayRowSignature(row.label))
      .filter((signature): signature is string => signature !== null);
  }

  function rejectSelfRead(detection: EraDetection | null): EraDetection | null {
    if (!detection || !normalizeEra(detection.era || null)) return detection;
    const preview = normalizeOcrPhrase(detection.textPreview);
    if (!preview || !overlayRowSignatures.some((signature) => preview.includes(signature))) {
      return detection;
    }
    log.info(
      `[RelicSelection] era read matched our own overlay rows, ignoring candidate=${String(
        detection.candidateId || "-",
      )}`,
    );
    return { ...detection, era: null, confidence: 0 };
  }

  function sendFallbackRows(scanToken: number, source: string, era: string | null): void {
    const startedAt = Date.now();
    try {
      const { rows, mrRows, totalOwnedCount } = buildRecommendations(era);
      if (scanToken !== activeScanToken) return;

      rememberOverlayRows([...rows, ...mrRows]);
      windows.sendOverlayEvent(RELIC_RECOMMENDATIONS, {
        source,
        era,
        rows,
        mrRows,
        totalOwnedCount,
        ocrUnavailable: eraOcrUnavailable(),
        detection: {
          confidence: 0,
          textPreview: "",
          elapsedMs: 0,
        },
      });

      if (rows.length > 0) {
        windows.scheduleOverlayAutoHide(OVERLAY_AUTO_HIDE_SUCCESS_MS);
      }

      log.info(
        `[RelicSelection] fallback rows sent count=${rows.length} elapsed=${Date.now() - startedAt}ms token=${scanToken}`,
      );
    } catch (err) {
      if (scanToken !== activeScanToken) return;
      log.warn("[RelicSelection] fallback rows failed:", normalizeErrorMessage(err));
    }
  }

  async function runRefinement(
    scanToken: number,
    source: string,
    preferredDisplayIdInitial: string | null,
  ): Promise<void> {
    const refineStartedAt = Date.now();
    let preferredDisplayId = preferredDisplayIdInitial;

    try {
      const eraDetectStartedAt = Date.now();

      // Era detection already captures the screen, so skip the separate anchor capture.
      const cacheAge = Date.now() - activeMissionTierSetAt;
      let era: string | null =
        logMissionTier ||
        (activeMissionTier && cacheAge < RELIC_MISSION_TIER_CACHE_TTL_MS
          ? activeMissionTier
          : null);
      let eraConfidence = era ? 1.0 : 0;

      if (era) {
        // Only the EE.log tag renews its lease; it is authoritative for the
        // whole mission. An OCR guess ages from when it was read, or one wrong
        // read survives every relic screen the player opens after it.
        if (logMissionTier) activeMissionTierSetAt = Date.now();
        log.info(
          logMissionTier
            ? `[RelicSelection] mission tier from EE.log tag: ${era}`
            : `[RelicSelection] mission tier cache hit: ${era} (age ${Math.round(cacheAge / 1000)}s)`,
        );
        if (logMissionTier && typeof rewardScanner.detectRelicSelectionEra === "function") {
          // Mission tags can linger into an omnia picker. A confident visible tab
          // overrides the tag; missing tabs keep it for mid-mission screens.
          const labelDetection = rejectSelfRead(
            await rewardScanner.detectRelicSelectionEra({
              timeoutMs: ERA_DETECTION_TIMEOUT_MS,
              preferredDisplayId,
              labelOnly: true,
            }),
          );
          if (scanToken !== activeScanToken) return;

          if (labelDetection?.sourceDisplayId) {
            windows.setAnchorMeta({ sourceDisplayId: labelDetection.sourceDisplayId });
            preferredDisplayId = String(labelDetection.sourceDisplayId);
            lastKnownGameDisplayId = preferredDisplayId;
            windows.positionOverlayWindow(windows.getAnchorMeta());
          }

          const labelEra = normalizeEra(labelDetection?.era || null);
          const labelConfidence = toFiniteOr(labelDetection?.confidence, 0);
          if (
            labelEra &&
            labelConfidence >= 0.9 &&
            labelDetection?.candidateId === "filter-label" &&
            labelEra !== era
          ) {
            log.info(
              `[RelicSelection] filter label overrides mission tag: tag=${era} label=${labelEra}`,
            );
            era = labelEra;
            eraConfidence = labelConfidence;
            activeMissionTier = era;
            activeMissionTierSetAt = Date.now();
          }
        } else if (typeof rewardScanner.captureSourceMeta === "function") {
          const captureMetaStartedAt = Date.now();
          try {
            const sourceMeta = await rewardScanner.captureSourceMeta({ preferredDisplayId });
            if (scanToken !== activeScanToken) return;
            log.info(
              `[RelicSelection] source meta elapsed=${Date.now() - captureMetaStartedAt}ms source=${String(
                sourceMeta?.sourceType || "unknown",
              )}:${String(sourceMeta?.sourceName || sourceMeta?.sourceId || "unknown")} display=${String(
                sourceMeta?.sourceDisplayId || "unknown",
              )}`,
            );
            if (sourceMeta?.sourceDisplayId) {
              windows.setAnchorMeta({ sourceDisplayId: sourceMeta.sourceDisplayId });
              preferredDisplayId = String(sourceMeta.sourceDisplayId);
              lastKnownGameDisplayId = preferredDisplayId;
              windows.positionOverlayWindow(windows.getAnchorMeta());
            }
          } catch {
            // non-critical, detection flow will still run
          }
        }
      } else if (desktopTierHint) {
        era = desktopTierHint;
        eraConfidence = 0.75;
        log.info(`[RelicSelection] using desktop tier hint without OCR: ${desktopTierHint}`);
      } else {
        const detectEra =
          typeof rewardScanner.detectRelicSelectionEra === "function"
            ? rewardScanner.detectRelicSelectionEra
            : null;
        let eraDetection = detectEra
          ? rejectSelfRead(
              await detectEra({ timeoutMs: ERA_DETECTION_TIMEOUT_MS, preferredDisplayId }),
            )
          : null;

        if (scanToken !== activeScanToken) return;

        // The first capture after app start can come back empty from a cold
        // capture/OCR start, so one delayed retry runs before the era filter is
        // dropped. A rejected self-read lands here too, and the delay gives the
        // overlay time to clear its stale cards before the second capture.
        if (detectEra && eraDetection && !normalizeEra(eraDetection.era || null)) {
          log.info("[RelicSelection] era read empty, retrying once");
          await new Promise((resolve) => setTimeout(resolve, ERA_DETECTION_RETRY_DELAY_MS));
          if (scanToken !== activeScanToken) return;
          const retryDetection = rejectSelfRead(
            await detectEra({
              timeoutMs: ERA_DETECTION_TIMEOUT_MS,
              preferredDisplayId,
            }),
          );
          if (scanToken !== activeScanToken) return;
          if (retryDetection) eraDetection = retryDetection;
        }

        if (eraDetection?.sourceDisplayId) {
          windows.setAnchorMeta({ sourceDisplayId: eraDetection.sourceDisplayId });
          lastKnownGameDisplayId = String(eraDetection.sourceDisplayId);
          windows.positionOverlayWindow(windows.getAnchorMeta());
        }

        era = normalizeEra(eraDetection?.era || null);
        eraConfidence = toFiniteOr(eraDetection?.confidence, 0);

        log.info(
          `[RelicSelection] era detection: era=${era || "none"} conf=${eraConfidence.toFixed(3)} ` +
            `source=${String(eraDetection?.sourceType || "unknown")}:${String(eraDetection?.sourceName || eraDetection?.sourceId || "unknown")} ` +
            `display=${String(eraDetection?.sourceDisplayId || "unknown")} ` +
            `candidate=${String(eraDetection?.candidateId || "-")} preview="${String(eraDetection?.textPreview || "")}"`,
        );

        // Cache a confident detection for the rest of this mission session.
        if (era && eraConfidence >= 0.9) {
          activeMissionTier = era;
          activeMissionTierSetAt = Date.now();
          log.info(`[RelicSelection] activeMissionTier set: ${era}`);
        }
      }

      log.info(`[RelicSelection] era detection elapsed=${Date.now() - eraDetectStartedAt}ms`);

      const shouldApplyEra = Boolean(era && eraConfidence >= 0.9);
      const effectiveEra = shouldApplyEra ? era : desktopTierHint;

      const { rows, mrRows, totalOwnedCount } = buildRecommendations(effectiveEra);
      if (scanToken !== activeScanToken) return;

      rememberOverlayRows([...rows, ...mrRows]);
      windows.sendOverlayEvent(RELIC_RECOMMENDATIONS, {
        source,
        era: effectiveEra,
        rows,
        mrRows,
        totalOwnedCount,
        ocrUnavailable: eraOcrUnavailable(),
        detection: {
          confidence: eraConfidence,
          textPreview: "",
          elapsedMs: toFiniteOr(Date.now() - eraDetectStartedAt, 0),
        },
      });

      windows.scheduleOverlayAutoHide(
        rows.length > 0 ? OVERLAY_AUTO_HIDE_SUCCESS_MS : OVERLAY_AUTO_HIDE_FAILURE_MS,
      );

      log.info(
        `[RelicSelection] refinement rows sent count=${rows.length} era=${
          effectiveEra || "none"
        } conf=${eraConfidence.toFixed(3)} elapsed=${Date.now() - refineStartedAt}ms token=${scanToken}`,
      );
    } catch (err) {
      if (scanToken !== activeScanToken) return;
      log.error("[RelicSelection] recommendation refinement failed:", normalizeErrorMessage(err));
      rememberOverlayRows([]);
      windows.sendOverlayEvent(RELIC_RECOMMENDATIONS, {
        source,
        era: null,
        rows: [],
        mrRows: [],
        ocrUnavailable: eraOcrUnavailable(),
      });
      windows.scheduleOverlayAutoHide(OVERLAY_AUTO_HIDE_FAILURE_MS);
    } finally {
      if (scanToken === activeScanToken) {
        inFlight = false;
      }
    }
  }

  async function onRelicSelectionTrigger(source = "manual") {
    if (source === "eelog") {
      const now = Date.now();
      if (toFiniteOr(ctx.overlayDismissedUntilMs, 0) > now) {
        return;
      }
      if (now - lastEelogTriggerAt < MIN_EELOG_TRIGGER_GAP_MS) {
        return;
      }
      lastEelogTriggerAt = now;
    }

    const scanToken = activeScanToken + 1;
    activeScanToken = scanToken;

    if (inFlight) {
      log.info(`[RelicSelection] replacing in-flight planner scan (${source})`);
    }

    inFlight = true;

    try {
      if (source === "eelog" && !ctx.overlaySettings.autoTriggerEnabled) {
        inFlight = false;
        return;
      }

      let preferredDisplayId: string | null = lastKnownGameDisplayId;

      if (preferredDisplayId) {
        windows.setAnchorMeta({ sourceDisplayId: preferredDisplayId });
      }

      windows.clearOverlayAutoHideTimer();
      windows.createOverlayWindow();
      windows.positionOverlayWindow(windows.getAnchorMeta());
      log.info(
        `[RelicSelection] overlay show request source=${source} anchorDisplay=${String(
          windows.getAnchorMeta()?.sourceDisplayId || "unknown",
        )} token=${scanToken}`,
      );
      windows.sendOverlayEvent(RELIC_PLANNER_TRIGGER, { source });
      windows.scheduleOverlayAutoHide(OVERLAY_AUTO_HIDE_DETECTING_MAX_MS);

      // Avoid flashing all eras before OCR by sending rows only with a cached era.
      const cachedEra =
        logMissionTier ||
        (activeMissionTier && Date.now() - activeMissionTierSetAt < RELIC_MISSION_TIER_CACHE_TTL_MS
          ? activeMissionTier
          : null);
      if (cachedEra) {
        sendFallbackRows(scanToken, source, cachedEra);
      }

      setTimeout(() => {
        void runRefinement(scanToken, source, preferredDisplayId);
      }, eraStartDelayMs);
    } catch (err) {
      if (scanToken !== activeScanToken) return;
      inFlight = false;
      log.error("[RelicSelection] recommendation pipeline failed:", normalizeErrorMessage(err));
      rememberOverlayRows([]);
      windows.sendOverlayEvent(RELIC_RECOMMENDATIONS, {
        source,
        era: null,
        rows: [],
        mrRows: [],
        ocrUnavailable: eraOcrUnavailable(),
      });
      windows.scheduleOverlayAutoHide(OVERLAY_AUTO_HIDE_FAILURE_MS);
    }
  }

  function suppressReopenForClose(): void {
    ctx.overlayDismissedUntilMs = Date.now() + REOPEN_SUPPRESS_AFTER_CLOSE_MS;
  }

  function setDesktopFilters(filters: { squadSize?: number; tierFilter?: string | null }): void {
    if (typeof filters.squadSize === "number" && filters.squadSize >= 1 && filters.squadSize <= 4) {
      desktopSquadSize = filters.squadSize;
    }
    if (filters.tierFilter !== undefined) {
      desktopTierHint = normalizeEra(filters.tierFilter);
    }
    cache = null;
    log.info(
      `[RelicSelection] desktop filters updated: squadSize=${desktopSquadSize} tierHint=${desktopTierHint || "all"}`,
    );
  }

  function resetMissionTier(): void {
    if (activeMissionTier) {
      log.info(`[RelicSelection] activeMissionTier cleared (menu closed)`);
    }
    // logMissionTier survives picker closes on purpose: the tag only fires on
    // mission load, and the era holds for the whole mission.
    activeMissionTier = null;
    activeMissionTierSetAt = 0;
  }

  function setActiveMissionTag(tag: string): void {
    const era =
      VOID_TAG_ERAS[
        String(tag || "")
          .trim()
          .toUpperCase()
      ] ?? null;
    if (era) {
      if (logMissionTier !== era) {
        log.info(`[RelicSelection] mission tier from EE.log tag ${tag}: ${era}`);
      }
      logMissionTier = era;
    } else if (logMissionTier) {
      log.info(`[RelicSelection] mission tier cleared (non-fissure tag ${tag})`);
      logMissionTier = null;
    }
    // shared so the reward overlay can shorten its omnia auto-hide
    ctx.activeFissureTier = logMissionTier;
  }

  return {
    onRelicSelectionTrigger,
    suppressReopenForClose,
    setDesktopFilters,
    resetMissionTier,
    setActiveMissionTag,
    getSnapshotPrice,
  };
}
