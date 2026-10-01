// Turns Loid's Arcane Dissolution table, the Arcane Enhancement odds list and
// Module:Arcane/data into collection pools and Vosfor yields. Pure - no network.

export const LOID_PAGE = "Loid_(Original)";
export const ENHANCEMENT_PAGE = "Arcane_Enhancement";
export const ARCANE_MODULE = "Module:Arcane/data";

const RARITIES = ["Common", "Uncommon", "Rare", "Legendary"];

function section(text, begin, end) {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end, start + begin.length);
  if (start === -1 || stop === -1) throw new Error(`no ${begin} section`);
  return text.slice(start + begin.length, stop);
}

function oddsCell(cell) {
  if (/^'''-'''$/.test(cell.trim())) return null;
  const chance = /'''(\d+(?:\.\d+)?)%'''/.exec(cell);
  const count = /×\s*(\d+)/.exec(cell);
  if (!chance || !count) throw new Error(`unreadable odds cell: ${cell}`);
  return { chance: Number(chance[1]), count: Number(count[1]) };
}

/** Each collection is a `!rowspan=2|...<br>Name` header, a row of arcane cells
 *  per rarity column, then a row of `'''45%''' (... × 2)` odds cells. */
export function parseLoidCollections(loidText) {
  const body = section(loidText, "<section begin=loidogoffer/>", "<section end=loidogoffer");
  const columns = [...body.matchAll(/Icon(\w+)\.png\|class=icon\]\]/g)].map((m) => m[1]);
  if (columns.length === 0 || columns.some((rarity) => !RARITIES.includes(rarity))) {
    throw new Error(`unexpected rarity columns: ${columns.join(", ")}`);
  }
  const lines = body.split("\n").map((line) => line.trim());
  const collections = [];
  for (let i = 0; i < lines.length; i++) {
    const header = /^!rowspan=2\|.*<br>(.+)$/i.exec(lines[i]);
    if (!header) continue;
    const cells = (from) => {
      const out = [];
      let j = from;
      while (out.length < columns.length && j < lines.length) {
        const line = lines[j++];
        if (line === "|-") continue;
        if (!line.startsWith("|")) throw new Error(`${header[1]}: unexpected line ${line}`);
        out.push(line.slice(1));
      }
      return { out, next: j };
    };
    const arcaneRow = cells(i + 1);
    const oddsRow = cells(arcaneRow.next);
    const name = header[1].trim();
    const pools = [];
    columns.forEach((rarity, index) => {
      const arcanes = [...arcaneRow.out[index].matchAll(/\{\{Arcane\|([^}|]+)\}\}/g)].map((m) =>
        m[1].trim(),
      );
      const odds = oddsCell(oddsRow.out[index]);
      if (!odds && arcanes.length === 0) return;
      if (!odds || arcanes.length !== odds.count) {
        throw new Error(
          `${name} ${rarity}: ${arcanes.length} arcanes vs odds ${oddsRow.out[index]}`,
        );
      }
      pools.push({
        rarity,
        chance: odds.chance,
        arcanes: arcanes.sort((a, b) => a.localeCompare(b)),
      });
    });
    const total = pools.reduce((sum, pool) => sum + pool.chance, 0);
    if (Math.abs(total - 100) > 1e-9) throw new Error(`${name}: pool chances sum to ${total}%`);
    collections.push({ name, pools });
    i = oddsRow.next - 1;
  }
  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

/** The Dissolution section's price line and per-collection odds bullets. */
export function parseEnhancementOdds(enhancementText) {
  const body = section(enhancementText, "=== Dissolution ===", "==== Dissolution Efficiency");
  const vosfor = /\{\{Resource\|Vosfor\|(\d+)\}\}/.exec(body);
  const credits = /\{\{cc\|([\d,]+)\}\}/.exec(body);
  const perPack = /gives '''(\d+)''' arcanes per purchase/.exec(body);
  if (!vosfor || !credits || !perPack) throw new Error("no collection price in Dissolution");
  const odds = new Map();
  let current = null;
  for (const line of body.split("\n")) {
    const heading = /^\*'''(.+?) Arcane Collection'''/.exec(line);
    if (heading) {
      current = new Map();
      odds.set(heading[1].trim(), current);
      continue;
    }
    const bullet =
      /^\*\*'''(\d+(?:\.\d+)?)%''' chance for an? (\w+) arcane \('''(\d+(?:\.\d+)?)%''' for each/.exec(
        line,
      );
    if (bullet && current) {
      const rarity = bullet[2][0].toUpperCase() + bullet[2].slice(1).toLowerCase();
      current.set(rarity, { chance: Number(bullet[1]), each: Number(bullet[3]) });
    }
  }
  return {
    cost: { vosfor: Number(vosfor[1]), credits: Number(credits[1].replace(/,/g, "")) },
    arcanesPerPack: Number(perPack[1]),
    odds,
  };
}

/** Every arcane the data module gives a Dissolution value, keyed by its Name. */
export function parseYields(arcaneModule) {
  const out = {};
  for (const [key, entry] of Object.entries(arcaneModule?.Arcanes ?? {})) {
    if (typeof entry?.Dissolution !== "number") continue;
    out[entry.Name ?? key] = entry.Dissolution;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Loid's table is the source; the Enhancement page must agree on which
 *  collections and rarities exist and on every pool's size, or this throws.
 *  A differing per-rarity chance is only reported, since the two pages drift. */
export function buildVosfor(loidText, enhancementText, arcaneModule) {
  const collections = parseLoidCollections(loidText);
  const { cost, arcanesPerPack, odds } = parseEnhancementOdds(enhancementText);
  const known = new Set(Object.keys(arcaneModule?.Arcanes ?? {}));
  const warnings = [];
  const loidNames = collections.map((c) => c.name).sort();
  const oddsNames = [...odds.keys()].sort();
  if (loidNames.join("|") !== oddsNames.join("|")) {
    throw new Error(
      `collections differ: Loid ${loidNames.join(", ")} vs Enhancement ${oddsNames.join(", ")}`,
    );
  }
  for (const collection of collections) {
    const stated = odds.get(collection.name);
    const rarities = collection.pools.map((pool) => pool.rarity);
    if (rarities.join("|") !== RARITIES.filter((r) => stated.has(r)).join("|")) {
      throw new Error(
        `${collection.name}: rarities ${rarities.join(", ")} vs ${[...stated.keys()].join(", ")}`,
      );
    }
    for (const pool of collection.pools) {
      const { chance, each } = stated.get(pool.rarity);
      const size = Math.round(chance / each);
      if (size !== pool.arcanes.length) {
        throw new Error(
          `${collection.name} ${pool.rarity}: ${pool.arcanes.length} arcanes, but ${chance}% at ${each}% each is ${size}`,
        );
      }
      if (chance !== pool.chance) {
        warnings.push(
          `${collection.name} ${pool.rarity}: Loid ${pool.chance}%, Enhancement ${chance}%`,
        );
      }
      for (const name of pool.arcanes) {
        if (!known.has(name))
          throw new Error(`${collection.name}: ${name} is not in ${ARCANE_MODULE}`);
      }
    }
  }
  return {
    data: {
      collections: collections.map((collection) => ({
        name: collection.name,
        ...cost,
        arcanesPerPack,
        pools: collection.pools.map((pool) => ({ ...pool, chance: pool.chance / 100 })),
      })),
      yields: parseYields(arcaneModule),
    },
    warnings,
  };
}
