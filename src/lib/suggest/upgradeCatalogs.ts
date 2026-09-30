import { ARCANE_CATALOG } from "./arcanes.js";
import { MOD_CATALOG } from "./mods.js";
import type { UpgradeCatalog, UpgradeKind } from "./upgrades.js";

export const UPGRADE_KINDS: readonly UpgradeKind[] = ["mods", "arcanes"];

export const UPGRADE_CATALOGS: Record<UpgradeKind, UpgradeCatalog> = {
  mods: MOD_CATALOG,
  arcanes: ARCANE_CATALOG,
};
