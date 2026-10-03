// Turns Module:Void/data's RelicData and Module:Void's p.RelicPack filter into
// the relic pack reward pool. Pure - no network.

import { parseLuaGlobal, parseLuaLocal } from "./lua.mjs";

export const VOID_MODULE = "Module:Void";
export const VOID_DATA_MODULE = "Module:Void/data";

/** The filter p.RelicPack applies, read out of its source so a change to it
 *  fails the build rather than drifting the pool. */
export function parseRelicPackRules(voidText) {
  const start = voidText.indexOf("function p.RelicPack(");
  if (start === -1) throw new Error(`no p.RelicPack in ${VOID_MODULE}`);
  const body = voidText.slice(start);
  const rarityMap = parseLuaLocal(body, "RarityMap");
  const excluded = parseLuaLocal(body, "EmpyreanDerelictRelics");
  const filter =
    /if (not relic\.Vaulted and not relic\.IsBaro and not EmpyreanDerelictRelics\[name\] and RarityMap\[relic\.Tier\] ~= nil) then/.exec(
      body,
    );
  if (!filter) throw new Error("p.RelicPack's pool filter changed");
  return {
    tiers: Object.keys(rarityMap ?? {}).sort(),
    excluded: Object.keys(excluded ?? {})
      .filter((name) => excluded[name] === true)
      .sort(),
  };
}

export function parseRelicData(voidDataText) {
  return parseLuaGlobal(voidDataText, "RelicData");
}

/** Every relic a pack can roll, by name, ordered by tier then name. */
export function buildRelicPackPool(relicData, rules) {
  const tiers = new Set(rules.tiers);
  const excluded = new Set(rules.excluded);
  const pool = [];
  for (const [key, relic] of Object.entries(relicData ?? {})) {
    if (!relic || typeof relic !== "object") continue;
    const name = typeof relic.Name === "string" ? relic.Name : key;
    if (relic.Vaulted || relic.IsBaro || excluded.has(name) || !tiers.has(relic.Tier)) continue;
    pool.push({ name, tier: relic.Tier });
  }
  const order = (tier) => ["Lith", "Meso", "Neo", "Axi"].indexOf(tier);
  pool.sort(
    (a, b) =>
      order(a.tier) - order(b.tier) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return pool.map((relic) => relic.name);
}

export function buildRelicPacks(voidText, voidDataText) {
  const rules = parseRelicPackRules(voidText);
  return { pool: buildRelicPackPool(parseRelicData(voidDataText), rules) };
}
