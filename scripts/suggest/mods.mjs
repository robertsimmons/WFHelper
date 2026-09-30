// Folds Overframe's per-item top mod lists into one popularity-ordered mod list.

const WIKI_BASE = "https://wiki.warframe.com/w/";

/** The same slug the app's wiki button builds. */
export function upgradeWikiUrl(name) {
  return `${WIKI_BASE}${encodeURIComponent(String(name).replace(/ /g, "_"))}`;
}

/** One point per item whose list names the mod, however often or wherever it
 *  appears there. Primed and base mods are different names, so they count apart. */
export function foldPopularMods(popularMods) {
  const counts = new Map();
  for (const list of Object.values(popularMods ?? {})) {
    if (!Array.isArray(list)) continue;
    const names = new Set(list.filter((name) => typeof name === "string" && name.trim()));
    for (const name of names) {
      const key = name.trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([name, count]) => ({ name, count, wikiUrl: upgradeWikiUrl(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
