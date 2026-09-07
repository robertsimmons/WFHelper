import type { AcquisitionTarget } from "./types.js";

/** Every distinct thing the sweep returns: the two suits, and a weapon per class. */
export const ACQUISITION_INCLUDES = [
  "warframe",
  "primary",
  "secondary",
  "melee",
  "archwing",
  "archgun",
  "archmelee",
  "companion",
] as const;

export type AcquisitionInclude = (typeof ACQUISITION_INCLUDES)[number];

export function includeOf(target: AcquisitionTarget): AcquisitionInclude | null {
  if (target.kind === "warframe") return "warframe";
  if (target.kind === "archwing") return "archwing";
  const weapon = target.weaponClass;
  return weapon && (ACQUISITION_INCLUDES as readonly string[]).includes(weapon) ? weapon : null;
}

/** An empty selection reads as "all", as the section filters above it do, and a
 *  target of no kind the list knows is never the one hidden. */
export function includesTarget(
  selected: readonly AcquisitionInclude[],
  target: AcquisitionTarget,
): boolean {
  if (selected.length === 0) return true;
  const kind = includeOf(target);
  return kind === null || selected.includes(kind);
}
