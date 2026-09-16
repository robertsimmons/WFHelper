import type { MessageKey } from "../../i18n.js";
import type { AcquisitionTarget, ModularGear, WeaponClass } from "./types.js";

/** Reserved: the empty list is the stored spelling of "every kind", so a
 *  genuinely empty selection needs one of its own. No target is ever classed as
 *  this, and the row never offers it as a box. */
export const ACQUISITION_NONE = "none";

export type AcquisitionInclude =
  | typeof ACQUISITION_NONE
  | "warframe"
  | "primary"
  | "secondary"
  | "melee"
  | "sentinel"
  | "companion"
  | "beast"
  | "robotic"
  | "archwing"
  | "archgun"
  | "archmelee"
  | "necramech"
  | "amp"
  | "kdrive";

export type AcquisitionGroupId = "warframes" | "weapons" | "companions" | "archwing" | "other";

export interface AcquisitionIncludeMember {
  include: AcquisitionInclude;
  labelKey: MessageKey;
}

export interface AcquisitionIncludeGroup {
  id: AcquisitionGroupId;
  labelKey: MessageKey;
  /** Set only where the group is a plain toggle rather than a dropdown; its
   *  `members` are then empty. */
  include: AcquisitionInclude | null;
  members: readonly AcquisitionIncludeMember[];
}

/** What the filter row draws and what the resolver classes against, in the one
 *  place. A sentinel's gun sits with the pet rather than with the weapons:
 *  Helios and Deconstructor are farmed in the same place. */
export const ACQUISITION_INCLUDE_GROUPS: readonly AcquisitionIncludeGroup[] = [
  {
    id: "warframes",
    labelKey: "nextUp.kindWarframe",
    include: "warframe",
    members: [],
  },
  {
    id: "weapons",
    labelKey: "nextUp.kindGroupWeapons",
    include: null,
    members: [
      { include: "primary", labelKey: "nextUp.kindPrimary" },
      { include: "secondary", labelKey: "nextUp.kindSecondary" },
      { include: "melee", labelKey: "nextUp.kindMelee" },
    ],
  },
  {
    id: "companions",
    labelKey: "nextUp.kindGroupCompanions",
    include: null,
    members: [
      { include: "sentinel", labelKey: "nextUp.kindSentinel" },
      { include: "companion", labelKey: "nextUp.kindCompanion" },
      { include: "beast", labelKey: "nextUp.kindBeast" },
      { include: "robotic", labelKey: "nextUp.kindRobotic" },
    ],
  },
  {
    id: "archwing",
    labelKey: "nextUp.kindArchwing",
    include: null,
    members: [
      { include: "archwing", labelKey: "nextUp.kindArchwingSuit" },
      { include: "archgun", labelKey: "nextUp.kindArchgun" },
      { include: "archmelee", labelKey: "nextUp.kindArchmelee" },
    ],
  },
  {
    id: "other",
    labelKey: "nextUp.kindGroupOther",
    include: null,
    members: [
      { include: "necramech", labelKey: "nextUp.kindNecramech" },
      { include: "amp", labelKey: "nextUp.kindAmp" },
      { include: "kdrive", labelKey: "nextUp.kindKdrive" },
    ],
  },
];

/** Every include the groups hold, in the order the row reads them. */
export const ACQUISITION_INCLUDES: readonly AcquisitionInclude[] =
  ACQUISITION_INCLUDE_GROUPS.flatMap((group) =>
    group.include ? [group.include] : group.members.map((member) => member.include),
  );

const WEAPON_INCLUDE: Record<WeaponClass, AcquisitionInclude> = {
  primary: "primary",
  secondary: "secondary",
  melee: "melee",
  archgun: "archgun",
  archmelee: "archmelee",
  companion: "companion",
};

const MODULAR_INCLUDE: Record<ModularGear, AcquisitionInclude> = {
  moa: "robotic",
  hound: "robotic",
  amp: "amp",
  kdrive: "kdrive",
};

export function includeOf(target: AcquisitionTarget): AcquisitionInclude | null {
  switch (target.kind) {
    case "warframe":
      return "warframe";
    case "archwing":
      return "archwing";
    case "sentinel":
      return "sentinel";
    case "beast":
      return "beast";
    case "necramech":
      return "necramech";
    case "modular":
      return target.modular ? MODULAR_INCLUDE[target.modular.gear] : null;
    case "weapon":
      return target.weaponClass ? WEAPON_INCLUDE[target.weaponClass] : null;
  }
}

/** An empty selection reads as "all", as the section filters above it do, and a
 *  target of no kind the list knows is never the one hidden. */
export function includesTarget(
  selected: readonly AcquisitionInclude[],
  target: AcquisitionTarget,
): boolean {
  if (selected.length === 0) return true;
  if (selected.includes(ACQUISITION_NONE)) return false;
  const kind = includeOf(target);
  return kind === null || selected.includes(kind);
}
