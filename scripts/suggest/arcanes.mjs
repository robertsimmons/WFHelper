// Folds Overframe builds into one popularity-ordered arcane list. Nothing here
// touches the network or node builtins, so the parsing is testable on its own.

import { upgradeWikiUrl } from "./mods.mjs";

export const BUILD_VOTE_FLOOR = 300;

/** An item's top build plus every build over the floor. */
export function countedBuilds(builds) {
  const sorted = [...(builds ?? [])]
    .filter((build) => build && typeof build.id === "number")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return sorted.filter((build, index) => index === 0 || (build.score ?? 0) > BUILD_VOTE_FLOOR);
}

/** A score-ordered page runs on while its last build still clears the floor. */
export function needsNextPage(page) {
  const results = page?.results ?? [];
  const last = results[results.length - 1];
  return Boolean(page?.next) && (last?.score ?? 0) > BUILD_VOTE_FLOOR;
}

/** The arcanes a build slots, as uniqueNames. Nothing else on the build is read. */
export function slottedArcanes(build, arcanePathById) {
  const out = new Set();
  for (const slot of build?.slots ?? []) {
    const path = arcanePathById.get(slot?.mod);
    if (path) out.add(path);
  }
  return [...out];
}

/** One point per build that slots the arcane. Every arcane `names` knows is
 *  listed, those no build slots at the foot, so a search can reach all of them. */
export function foldArcaneBuilds(buildArcanes, names) {
  const counts = new Map();
  for (const name of names.values()) counts.set(name, 0);
  for (const paths of buildArcanes) {
    const seen = new Set(paths.map((path) => names.get(path)).filter(Boolean));
    for (const name of seen) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count, wikiUrl: upgradeWikiUrl(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const WEBPACK_SRC_RE = /<script[^>]+src="([^"]*\/static\/chunks\/webpack-[^"]+\.js)"/;

/** The site's webpack runtime, which names every lazy chunk's file. */
export function webpackRuntimeUrl(html) {
  return WEBPACK_SRC_RE.exec(html)?.[1] ?? null;
}

/** Overframe's own mod database, arcanes included, ships as a lazy chunk. */
export function modDbChunkUrl(runtime, runtimeUrl) {
  const id = /[{,](\d+):"db\/mods"/.exec(runtime)?.[1];
  if (!id) return null;
  const hash = new RegExp(`[{,]${id}:"([0-9a-f]+)"`).exec(runtime)?.[1];
  if (!hash) return null;
  const base = runtimeUrl.slice(0, runtimeUrl.indexOf("static/chunks/"));
  return `${base}static/chunks/db/mods.${hash}.js`;
}

function unescapeJsString(text) {
  return text.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, code) => {
    if (code[0] === "u" && code.length === 5)
      return String.fromCharCode(parseInt(code.slice(1), 16));
    if (code[0] === "x" && code.length === 3)
      return String.fromCharCode(parseInt(code.slice(1), 16));
    return { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" }[code] ?? code;
  });
}

/** Overframe mod id to DE uniqueName, off the chunk's `JSON.parse('...')` body. */
export function parseModDb(chunk) {
  const open = chunk.indexOf("JSON.parse('");
  const close = chunk.lastIndexOf("')");
  if (open === -1 || close <= open) return new Map();
  const db = JSON.parse(unescapeJsString(chunk.slice(open + "JSON.parse('".length, close)));
  const out = new Map();
  for (const entry of Object.values(db)) {
    if (typeof entry?.id === "number" && typeof entry.path === "string") {
      out.set(entry.id, entry.path);
    }
  }
  return out;
}
