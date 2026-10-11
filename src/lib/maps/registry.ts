import { MAP_IMAGE_URLS } from "../assetUrls.js";

export interface BaseMap {
  key: string;
  name: string;
  imageUrl: string;
  /** Side of the square wiki grid the image and its pins share. */
  size: number;
  credit: string;
  /** The background baked into the image, for the letterbox around it. */
  backdrop: string | null;
}

const WIKI_CREDIT = "Map and marker data: wiki.warframe.com (CC BY-NC-SA)";

const NAMES: Readonly<Record<keyof typeof MAP_IMAGE_URLS, string>> = {
  duviri: "Duviri",
  "orb-vallis": "Orb Vallis",
  "cambion-drift": "Cambion Drift",
  "plains-of-eidolon": "Plains of Eidolon",
};

// Sampled from each image's corner pixels; the transparent ones need none.
const BACKDROPS: Readonly<Partial<Record<keyof typeof MAP_IMAGE_URLS, string>>> = {
  duviri: "#35383e",
  "cambion-drift": "#363a3f",
};

const BASE_MAPS = new Map<string, BaseMap>(
  (Object.keys(NAMES) as (keyof typeof NAMES)[]).map((key) => [
    key,
    {
      key,
      name: NAMES[key],
      imageUrl: MAP_IMAGE_URLS[key],
      size: 4000,
      credit: WIKI_CREDIT,
      backdrop: BACKDROPS[key] ?? null,
    },
  ]),
);

/** Places that sit inside a base map open that map. */
const ALIASES = new Map<string, string>([
  ["kullervos-hold", "duviri"],
  ["archarbor", "duviri"],
]);

/** Null for a key no shipped map draws. */
export function baseMapKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const target = ALIASES.get(key) ?? key;
  return BASE_MAPS.has(target) ? target : null;
}

export function baseMap(key: string | null | undefined): BaseMap | null {
  const target = baseMapKey(key);
  return target ? (BASE_MAPS.get(target) ?? null) : null;
}

/** The wiki grid's origin is bottom-left; the screen's is top-left. */
export function toScreen(position: readonly [number, number], size: number): [number, number] {
  return [position[0], size - position[1]];
}
