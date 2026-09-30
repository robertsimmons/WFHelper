import { MOD_CATALOG } from "../mods.js";
import { createUpgradeProvider } from "./upgrades.js";

/** The whole domain answers to one activity setting, as Nightwave's acts do. */
export const MODS_ACTIVITY = "mods";

export const modsProvider = createUpgradeProvider(MOD_CATALOG, MODS_ACTIVITY, "modSearch");
