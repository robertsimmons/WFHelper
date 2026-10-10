export type RelicQuality = "intact" | "exceptional" | "flawless" | "radiant";

export interface RelicReward {
  name: string;
  displayName?: string;
  uniqueName?: string | null;
  imageUrl?: string | null;
  rarity: string;
  chance: number;
  urlName: string | null;
  wfmId?: string | null;
  ducats: number | null;
}

export interface RelicQualityData {
  uniqueName: string | null;
  rewards: RelicReward[];
}

/** Where the live drop tables say a relic drops: "none" is vaulted. */
export type RelicDropping = "missions" | "caches" | "none";

export interface RelicCache {
  /** "Pluto Proxima". */
  region: string;
  chance: number;
}

export interface RelicGroup {
  key: string;
  name: string;
  tier: string;
  code: string;
  vaulted?: boolean;
  /** Null or absent until the drop tables load; `vaulted` is the bundled flag then. */
  dropping?: RelicDropping | null;
  /** Railjack derelict caches it drops from, best chance per region. */
  caches?: RelicCache[];
  imageUrl: string | null;
  qualities: Partial<Record<RelicQuality, RelicQualityData>>;
  [key: string]: unknown;
}

interface RelicGroupLookup {
  groupKey: string;
  quality: RelicQuality;
}

export interface RelicDatabase {
  groups: Record<string, RelicGroup>;
  byUniqueName: Record<string, RelicGroupLookup>;
}

export interface OwnedQualityCounts {
  intact: number;
  exceptional: number;
  flawless: number;
  radiant: number;
}

export type OwnedCounts = Record<string, OwnedQualityCounts>;
