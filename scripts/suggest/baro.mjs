// Baro Ki'Teer's price list from the wiki's Module:Baro/data. Pure - no
// network, no fs - so the parser stays unit testable.

import { parseLuaTable } from "./lua.mjs";
import { normalizeName } from "./overframe.mjs";

export const BARO_MODULE = "Module:Baro/data";

function price(entry) {
  const out = {};
  if (typeof entry?.DucatCost === "number" && entry.DucatCost > 0) out.ducats = entry.DucatCost;
  if (typeof entry?.CreditCost === "number" && entry.CreditCost > 0) out.credits = entry.CreditCost;
  return Object.keys(out).length > 0 ? out : null;
}

/** Normalized item name to { ducats, credits }, for every item Baro has sold. */
export function parseBaroPrices(text) {
  const data = parseLuaTable(text);
  const out = {};
  for (const table of [data?.Items, data?.ExtraItems]) {
    for (const [key, entry] of Object.entries(table ?? {})) {
      const cost = price(entry);
      if (cost) out[normalizeName(entry?.Name ?? key)] = cost;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
