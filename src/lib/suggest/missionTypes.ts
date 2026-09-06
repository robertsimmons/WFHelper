import type { MissionOpinion, SuggestionPreferences } from "../../types/suggest.js";

/** The world-state parser emits "Extermination" where the tables say "Exterminate". */
const ALIASES: Record<string, string> = { extermination: "exterminate" };

/** Mission names arrive already resolved to display text, so case and spacing
 *  are the only things that vary. Counts and blueprints never appear here, which
 *  is why this is not the reward normalizer. */
export function normalizeType(name: string): string {
  const key = name.toLowerCase().replace(/\s+/g, " ").trim();
  return ALIASES[key] ?? key;
}

/** Null means unrated, which the caller reads as no opinion - never as bad. */
export function missionOpinion(
  prefs: SuggestionPreferences,
  name: string | null | undefined,
): MissionOpinion | null {
  if (!name) return null;
  return prefs.missionTypes[normalizeType(name)] ?? null;
}

export interface MissionRead {
  /** The ones worth warning about, in the order the game lists them. */
  slow: string[];
  /** True only when every mission is one the player is known to like. */
  allFast: boolean;
}

export function readMissions(prefs: SuggestionPreferences, names: readonly string[]): MissionRead {
  const slow = names.filter((name) => missionOpinion(prefs, name) === "bad");
  const allFast = names.length > 0 && names.every((name) => missionOpinion(prefs, name) === "good");
  return { slow, allFast };
}
