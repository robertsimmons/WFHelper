import { ARCANE_CATALOG } from "../arcanes.js";
import { createUpgradeProvider } from "./upgrades.js";

export const ARCANES_ACTIVITY = "arcanes";

export const arcanesProvider = createUpgradeProvider(
  ARCANE_CATALOG,
  ARCANES_ACTIVITY,
  "arcaneSearch",
);
