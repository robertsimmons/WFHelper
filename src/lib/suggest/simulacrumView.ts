import { STAR_CHART_PLANET_ART, TILE_SET_ART } from "../assetUrls.js";
import type { Translator } from "../i18n.js";
import { nodeTier } from "./simulacrum.js";
import type { SimulacrumCard, SimulacrumGap, SimulacrumStop } from "./simulacrum.js";
import type { Suggestion } from "../../types/suggest.js";

export const isProbable = (gap: SimulacrumGap): boolean => gap.probable === true;

function leadGap(card: SimulacrumCard): SimulacrumGap | null {
  const stop = card.stops[0];
  return stop?.gaps[0] ?? stop?.regulars[0] ?? card.gaps[0] ?? null;
}

/** Planet art, else the lead enemy's, else the tileset's. */
export function cardArt(
  card: SimulacrumCard,
  enemyImage: (image: string | null) => string | null,
): string | null {
  const planet = card.kind === "tileSet" ? card.stops[0]?.node.planet : card.place;
  return (
    (planet ? STAR_CHART_PLANET_ART[planet] : undefined) ??
    enemyImage(leadGap(card)?.image ?? null) ??
    (card.place ? TILE_SET_ART[card.place] : undefined) ??
    null
  );
}

/** Heading and subtitle. An archwing card heads "Archwing", since its tileset
 *  (Free Space) means nothing to a player; the subtitle lists the stops' planets
 *  in stop order, since a tileset card spans several. */
export function cardTitle(card: SimulacrumCard, t: Translator): [string, string] {
  if (card.kind === "steelPath") return [t("common.steelPath"), ""];
  if (card.kind === "unplaced") return [t("nextUp.simUnknownLocation"), ""];
  const lead = card.stops[0]?.node;
  const archwing = lead !== undefined && nodeTier(lead) === "archwing";
  const place = card.place?.replace(/ \(Tileset\)$/, "");
  const heading = archwing ? t("nextUp.kindArchwing") : (place ?? card.activity ?? "");
  const parts = card.activity && card.place ? [card.activity] : [];
  parts.push(...card.stops.map((stop) => stop.node.planet));
  return [heading, unique(parts.filter((part) => part !== heading)).join(", ")];
}

const unique = <T>(list: T[]): T[] => [...new Set(list)];

/** An activity is started from its place, whichever node the engine picked. */
export function stopLabel(card: SimulacrumCard, stop: SimulacrumStop): [string, string] {
  if (card.activity && card.place) return [card.place, card.activity];
  return [nodeWhere(stop.node), stop.node.missionType];
}

export const nodeWhere = (node: SimulacrumStop["node"]): string =>
  unique([node.name, node.planet]).join(", ");

/** Gaps the card decides on; a card of only regulars counts those instead. */
export function enemiesLeft(card: SimulacrumCard): number {
  const deciding = card.gaps.length + card.stops.reduce((sum, stop) => sum + stop.gaps.length, 0);
  if (deciding > 0) return deciding;
  return new Set(card.stops.flatMap((stop) => stop.regulars.map((gap) => gap.type))).size;
}

export function stopProgress(stop: SimulacrumStop): { enemies: number; scans: number } {
  const listed = [...stop.gaps, ...stop.regulars];
  const scans = listed.reduce((sum, gap) => sum + gap.cost, 0);
  return { enemies: listed.length, scans };
}

interface FactionCount {
  faction: string;
  count: number;
}

export function regularsByFaction(
  card: SimulacrumCard,
  factionOf: (type: string) => string | null,
): FactionCount[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const gap of card.stops.flatMap((stop) => stop.regulars)) {
    const faction = factionOf(gap.type);
    if (!faction || seen.has(gap.type)) continue;
    seen.add(gap.type);
    counts.set(faction, (counts.get(faction) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([faction, count]) => ({ faction, count }))
    .sort((a, b) => b.count - a.count || a.faction.localeCompare(b.faction));
}

/** The section machinery draws suggestions, so each card rides in one, best first. */
export function simulacrumSuggestions(cards: readonly SimulacrumCard[]): Suggestion[] {
  return cards.map((card, index) => ({
    id: `simulacrum:${card.key}`,
    category: "simulacrum",
    title: card.place ?? card.activity ?? card.kind,
    why: "",
    signals: { value: 1, effort: 0, urgency: 0 },
    score: 0,
    fingerprint: card.key,
    order: index,
    details: { simulacrum: card },
  }));
}
