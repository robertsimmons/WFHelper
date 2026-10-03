import { ACQUISITION_NONE } from "./kinds.js";
import { planSource } from "./plan/data.js";
import type { MessageKey } from "../../i18n.js";
import type { PlanSource } from "./plan/schema.js";
import type { AcquisitionTarget } from "./types.js";

/** The kinds row's reserved spelling, which no plan source can collide with. */
export type AcquisitionSourcePick = PlanSource | typeof ACQUISITION_NONE;

interface AcquisitionSourceOption {
  source: PlanSource;
  labelKey: MessageKey;
}

export const ACQUISITION_SOURCE_OPTIONS: readonly AcquisitionSourceOption[] = [
  { source: "shop", labelKey: "nextUp.sourceShop" },
  { source: "dojo", labelKey: "drops.kind.dojo" },
  { source: "standing", labelKey: "nextUp.sourceStanding" },
  { source: "repeat", labelKey: "nextUp.sourceRepeat" },
  { source: "bounties", labelKey: "world.bounties" },
  { source: "boss", labelKey: "nextUp.acqKindBoss" },
  { source: "railjack", labelKey: "world.railjack" },
  { source: "duviri", labelKey: "mastery.duviri" },
  { source: "relics", labelKey: "common.relics" },
  { source: "unique", labelKey: "nextUp.sourceUnique" },
];

/** Every source, in the order the popover reads them. */
export const ACQUISITION_SOURCES: readonly PlanSource[] = ACQUISITION_SOURCE_OPTIONS.map(
  (option) => option.source,
);

/** An empty selection reads as "all", as the kinds row's does. */
export function includesSource(
  selected: readonly AcquisitionSourcePick[],
  target: AcquisitionTarget,
): boolean {
  if (selected.length === 0) return true;
  if (selected.includes(ACQUISITION_NONE)) return false;
  return selected.includes(planSource(target.name));
}
