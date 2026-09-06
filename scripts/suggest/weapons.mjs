// Turns the Warframe wiki's weapon modules and article wikitext into the
// curated weapon acquisition table. Pure - no network, no fs.

export const WEAPON_MODULES = [
  "primary",
  "secondary",
  "melee",
  "archwing",
  "companion",
  "modular",
  "misc",
];

export const ADVERSARY_PAGES = ["Adversary System/Weapons"];

function listed(entry) {
  return Boolean(entry?.Name && entry?.Link && !entry._IgnoreEntry);
}

export function listWeapons(modules) {
  const seen = new Set();
  const out = [];
  for (const [group, table] of Object.entries(modules)) {
    for (const entry of Object.values(table ?? {})) {
      if (!listed(entry)) continue;
      const name = String(entry.Name);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        link: String(entry.Link),
        group,
        traits: Array.isArray(entry.Traits) ? entry.Traits.filter(Boolean) : [],
        lich: entry.IsLichWeapon === true,
        mastery: typeof entry.Mastery === "number" ? entry.Mastery : null,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Reads a {{...}} or [[...]] run from `open`, honouring nesting. */
function balanced(text, open, chars) {
  const [left, right] = chars;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text.startsWith(left, i)) {
      depth++;
      i += left.length - 1;
    } else if (text.startsWith(right, i)) {
      depth--;
      if (depth === 0) return { body: text.slice(open + left.length, i), end: i + right.length };
      i += right.length - 1;
    }
  }
  return null;
}

function splitParams(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith("{{", i) || body.startsWith("[[", i)) depth++;
    else if (body.startsWith("}}", i) || body.startsWith("]]", i)) depth--;
    if (body[i] === "|" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += body[i];
  }
  parts.push(current);
  return parts;
}

const CURRENCY = { cc: "Credits", sc: "Standing", pc: "Platinum", dc: "Ducats" };
/** Templates whose readable text is their last positional parameter. */
const LAST_PARAM = /^(?:weapon|wf|warframe|m|mod|a|d|faction|resource|item|tooltip|pol|conv)$/i;
const DROPPED_TEMPLATE = /^(?:ver|cite|ref|clr|-|br|sic|dead link|citation needed)$/i;

function renderTemplate(body) {
  const params = splitParams(body).map((part) => part.trim());
  const name = params[0].toLowerCase();
  const positional = params.slice(1).filter((part) => !/^[A-Za-z_]+\s*=/.test(part));
  if (CURRENCY[name]) return `${positional[0] ?? ""} ${CURRENCY[name]}`.trim();
  if (DROPPED_TEMPLATE.test(name)) return "";
  if (LAST_PARAM.test(name)) return positional[positional.length - 1] ?? "";
  return positional.length === 1 ? positional[0] : "";
}

const HTML_TAG = /<[^>]+>/g;
const MEDIA_LINK = /^\s*(?:File|Image|Category|Media)\s*:/i;
const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&ndash;": "-", "&mdash;": "-" };

/** Wiki markup down to the English sentence a player can act on. */
export function stripMarkup(text) {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text.startsWith("{{", i)) {
      const run = balanced(text, i, ["{{", "}}"]);
      if (run) {
        out += renderTemplate(stripMarkup(run.body));
        i = run.end;
        continue;
      }
    }
    if (text.startsWith("[[", i)) {
      const run = balanced(text, i, ["[[", "]]"]);
      if (run) {
        const params = splitParams(run.body);
        if (!MEDIA_LINK.test(params[0])) out += params[params.length - 1] ?? "";
        i = run.end;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return (
    out
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
      .replace(HTML_TAG, "")
      .replace(/'{2,}/g, "")
      .replace(/&\w+;/g, (entity) => ENTITIES[entity] ?? " ")
      .replace(/\[[^\s\]]+ ([^\]]*)\]/g, "$1")
      .replace(/\[\d+\]/g, "")
      .replace(/[ \t]+/g, " ")
      // Some articles spell the currency out next to the template that already does.
      .replace(/\b(Standing|Credits|Ducats|Platinum)(?: \1)+\b/g, "$1")
      .replace(/ ([,.;:])/g, "$1")
      .trim()
  );
}

const HEADING = /^=+ *([^=]+?) *=+\s*$/;

/** The statement is either an {{Acquisition}} template or an ==Acquisition==
 *  section; a few articles carry both and both are worth reading. */
export function extractAcquisition(wikitext) {
  const chunks = [];
  for (
    let i = wikitext.indexOf("{{Acquisition");
    i !== -1;
    i = wikitext.indexOf("{{Acquisition", i + 1)
  ) {
    const run = balanced(wikitext, i, ["{{", "}}"]);
    if (!run) continue;
    const positional = splitParams(run.body)
      .slice(1)
      .filter((part) => !/^\s*[A-Za-z_]+\s*=/.test(part));
    if (positional.length > 0) chunks.push(positional.join("|"));
  }
  const lines = wikitext.split("\n");
  let collecting = false;
  let section = [];
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      if (collecting) break;
      collecting = /^acquisition$/i.test(heading[1]);
      continue;
    }
    if (collecting) section.push(line);
  }
  if (section.length > 0) chunks.push(section.join("\n"));
  return chunks.length > 0 ? chunks.join("\n") : null;
}

const WIKITABLE = /^\{\|[\s\S]*?^\|\}\s*$/gm;
const LIST_MARKER = /^[*#:;]+\s*/;
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z"'(])/;

/** Trade rules, sale prices, platinum bundles, prerequisites and history are
 *  not a way to go and get the weapon. */
const NOISE =
  /can be sold for|\btrad(?:e|ed|ing|eable|able)\b|Mastery Rank of at least|stock changes with each appearance|free weapon slot|pre-installed|is no longer|was (?:available|initially|originally)|has been (?:vaulted|removed)|Baro Ki'Teer's stock|\bbundle\b|\bPlatinum\b|^Access requires\b|\bwill not be (?:given|awarded|received)\b/i;

/** A sentence that names no way of getting anything is context, not a source. */
const ACQUIRED =
  /\b(?:purchas\w*|bought|buy|sold|sells?|research\w*|drops?|dropped|obtain\w*|acquir\w*|award\w*|reward\w*|earn\w*|available|given|grant\w*|unlock\w*|complet\w*|defeat\w*|kill\w*|vanquish\w*|exchang\w*)\b/i;

export function splitStatements(wikitext) {
  const text = stripMarkup(wikitext.replace(WIKITABLE, ""));
  const out = [];
  for (const line of text.split(/\n+/)) {
    const body = line.replace(LIST_MARKER, "").trim();
    if (!body) continue;
    for (const sentence of body.split(SENTENCE_BREAK)) {
      const trimmed = sentence.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

// Vendor names stay case sensitive: "Father" is a syndicate offering, "father"
// is prose. The currencies they trade in are written either way.
const VENDOR_NAME =
  /\b(?:Baro Ki'Teer|Ergo Glast|Cephalon Simaris|Little Duck|Cavalero|Chipper|Eleanor|Father|Otak|Grandmother|Hok|Rude Zuud|Zuud|Onkko|Ticker|Bird 3|Nakak|Roky|Aspirant Zorba|The Business|Smokefinger|Fisher Hai-Luk|Master Teasonai|Konzu|Palladino|Maroo|Darvo|Teshin|Archimedean Yonta|Kahl's Garrison|Iron Wake|Nightwave|Ventkids|Ostrons|Solaris United|Entrati|Necraloid|The Holdfasts|Cavia|The Hex|Vox Solaris|Quills|Steel Meridian|Red Veil|New Loka|Arbiters of Hexis|Cephalon Suda|The Perrin Sequence|Operational Supply|Koumei's Shrine)\b/;
const VENDOR_CURRENCY =
  /\b(?:syndicates?|standing|ducats|aya|steel essence|holokeys?|heartcells?|vosfor|stock \(kahl\))\b/i;
/** Syndicate offerings are always written as a rank the player has to reach. */
const VENDOR_RANK = /\bRank \d+ - [A-Z]/;
const VENDOR = {
  test: (text) => VENDOR_NAME.test(text) || VENDOR_CURRENCY.test(text) || VENDOR_RANK.test(text),
};

const BOSS =
  /\b(?:assassinat\w*|boss(?:es)?|Stalker|Acolyte|Archon|Eidolon|Exploiter Orb|Profit-Taker|Ropalolyst|Jordas Golem|Lephantis|Jackal|Sargas Ruk|Vay Hek|Alad V|Kela De Thaym|Tyl Regor|Lech Kril|Captain Vor|Ambulas|Hyena|Raptor|The Sergeant|Phorid|Zanuka|Grustrag|Razorback|Wolf of Saturn Six)\b/i;

// The trailing "dropped by" clause catches the plain enemy drops, which name no
// mission type at all; it sits last so a named boss or vendor is read first.
const MISSION =
  /\b(?:Rotation|Survival|Defense|Exterminate|Disruption|Excavation|Interception|Sabotage|Capture|Rescue|Spy|Mobile Defense|Void Storm|Void Cascade|Void Flood|Void Armageddon|Empyrean|Railjack|Proxima|Dark Sector|caches?|Arbitration|Sortie|Alert|Invasion|Steel Path|The Circuit|Duviri|Index|Hell-Scrub|Legacyte Harvest|Mirror Defense|Ascension|missions?|node|dropped by|drops? from|defeat\w*)\b/i;

/** Ordered most specific first: a sentence that names a lab is about research
 *  even though it also says "Clan", and a syndicate sale is not the Market. */
const KIND_RULES = [
  [
    "lab",
    /\b(?:Tenno|Energy|Chem|Bio|Orokin) Lab\b|\bresearch(?:ed)?\b[\s\S]*\bdojo\b|\bdojo\b[\s\S]*\bresearch/i,
  ],
  ["junction", /\bJunction\b/],
  ["quest", /\bquest\b/i],
  ["bounty", /\bbount(?:y|ies)\b/i],
  ["vendor", VENDOR],
  ["market", /\bMarket\b/],
  ["boss", BOSS],
  ["mission", MISSION],
];

const COMPONENT =
  "components?|barrels?|receivers?|stocks?|blades?|hilts?|handles?|grips?|chambers?|guards?|rivets?|links?|discs?|heads?|parts";
const COMPONENT_WORDS = new RegExp(`\\b(?:${COMPONENT})\\b`, "i");
// "the barrel blueprint" is a component, not the weapon's own blueprint, so the
// attached mentions come out before the sentence is asked about a blueprint.
const COMPONENT_BLUEPRINT = new RegExp(`\\b(?:${COMPONENT})\\s+blueprints?\\b`, "gi");
const BLUEPRINT_WORDS = /\bblueprints?\b/i;

export function statementParts(statement) {
  const component = COMPONENT_WORDS.test(statement);
  const blueprint = BLUEPRINT_WORDS.test(statement.replace(COMPONENT_BLUEPRINT, ""));
  if (component && blueprint) return "both";
  if (component) return "components";
  if (blueprint) return "main";
  return "both";
}

const MAX_WHERE = 260;
/** A vendor the sentence names only by pronoun is unusable on its own line. */
const PRONOUN_SUBJECT = /^(?:She|He|They)\b/;

/** Null for a sentence no rule recognises - absent reads as unknown, and a
 *  guessed location is worse than none. */
export function classifyStatement(statement) {
  if (NOISE.test(statement) || !ACQUIRED.test(statement)) return null;
  if (PRONOUN_SUBJECT.test(statement)) return null;
  const where = statement.replace(/\s+/g, " ").trim();
  if (where.length < 10 || where.length > MAX_WHERE) return null;
  for (const [kind, pattern] of KIND_RULES) {
    if (pattern.test(where)) return { kind, parts: statementParts(where), where };
  }
  return null;
}

export function weaponSources(wikitext) {
  const acquisition = extractAcquisition(wikitext);
  if (!acquisition) return [];
  const out = [];
  const seen = new Set();
  for (const statement of splitStatements(acquisition)) {
    const source = classifyStatement(statement);
    if (!source || seen.has(source.where)) continue;
    seen.add(source.where);
    out.push(source);
  }
  return out;
}

const NEMESIS_TRAIT = [
  [/^Kuva Lich$/i, "kuva"],
  [/^Tenet$/i, "tenet"],
  [/^Technocyte Coda$/i, "coda"],
];

export function nemesisFamily(weapon) {
  for (const trait of weapon.traits) {
    for (const [pattern, family] of NEMESIS_TRAIT) {
      if (pattern.test(trait)) return family;
    }
  }
  return null;
}

const SECTION = /^==+ *([^=]+?) *=+\s*$/gm;

/** The adversary weapons page holds one section per family, and every nemesis
 *  weapon article transcludes the one that applies to it. */
export function transcludedSections(wikitext) {
  const out = {};
  const marks = [];
  let match = null;
  SECTION.lastIndex = 0;
  while ((match = SECTION.exec(wikitext)) !== null) {
    marks.push({ title: match[1], start: match.index + match[0].length });
  }
  marks.forEach((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].start : wikitext.length;
    out[mark.title] = wikitext
      .slice(mark.start, end)
      .replace(/^==+[^\n]*$/gm, "")
      .trim();
  });
  return out;
}

const TRANSCLUDE = /\{\{Transclude\|([^}|]+)\}\}/g;

export function resolveTranscludes(wikitext, sections, weaponName) {
  return wikitext.replace(TRANSCLUDE, (whole, target) => {
    const title = target.split("#")[1]?.trim();
    const body = title ? sections[title] : null;
    return body ? body.replace(/\{\{PAGENAME\}\}/g, weaponName) : "";
  });
}

const PROGENITOR_ELEMENTS = [
  "Impact",
  "Heat",
  "Cold",
  "Electricity",
  "Toxin",
  "Magnetic",
  "Radiation",
];

/** Coda are exempt from the progenitor system: the bonus is rolled by Eleanor's
 *  stock, not by the Warframe carried, so the spawn is a Mixtape hack instead. */
const CODA_NEMESIS = {
  family: "coda",
  requires: ["The Hex"],
  spawn:
    "Kill Techrot in a Höllvania Exterminate, Hell-Scrub or Legacyte Harvest mission to drop a Mixtape, then upload it at a terminal - a Duet then spawns at 25% per mission, guaranteed on the 4th",
  elements: PROGENITOR_ELEMENTS,
  bonus: { min: 25, max: 60 },
};

/** How much work the cheapest known path is, and nothing else: a shop or a
 *  research bench is easy, a gated grind is normal, an RNG farm is hard, and
 *  parts split across sources cost one step more. */
const KIND_EFFORT = {
  market: 0,
  junction: 0,
  lab: 0,
  quest: 2,
  vendor: 2,
  bounty: 3,
  mission: 3,
  boss: 3,
  nemesis: 4,
};

export function difficultyFor(sources, nemesis) {
  if (nemesis) return "hard";
  if (sources.length === 0) return null;
  const cheapest = Math.min(...sources.map((source) => KIND_EFFORT[source.kind] ?? 3));
  const split =
    sources.some((source) => source.parts === "main") &&
    sources.some((source) => source.parts === "components");
  const score = cheapest + (split ? 1 : 0);
  if (score === 0) return "easy";
  return score <= 2 ? "normal" : "hard";
}

/** Primes come out of relics wherever their base drops, which the app derives
 *  on its own, so a Prime article's text is about relics and not about a farm. */
function skipped(weapon) {
  return weapon.traits.some((trait) => /^prime$/i.test(trait));
}

export function buildEntry(weapon, wikitext, sections) {
  const family = nemesisFamily(weapon);
  if (family === "kuva" || family === "tenet") return null;
  const nemesis = family === "coda" ? CODA_NEMESIS : null;
  const sources = wikitext
    ? weaponSources(resolveTranscludes(wikitext, sections, weapon.name))
    : [];
  if (sources.length === 0 && !nemesis) return null;
  const difficulty = difficultyFor(sources, nemesis);
  return {
    ...(difficulty ? { difficulty } : {}),
    sources,
    ...(nemesis ? { nemesis } : {}),
  };
}

export function buildTable(weapons, articles, support) {
  const sections = transcludedSections(support["Adversary System/Weapons"] ?? "");
  const out = {};
  for (const weapon of weapons) {
    if (skipped(weapon)) continue;
    const entry = buildEntry(weapon, articles[weapon.link], sections);
    if (entry) out[weapon.name] = entry;
  }
  return out;
}

/** The progenitor element a Warframe hands to a Kuva or Tenet weapon. */
export function buildProgenitors(warframeModule) {
  const out = {};
  for (const frame of Object.values(warframeModule?.Warframes ?? {})) {
    if (!frame?.Name || typeof frame.Progenitor !== "string") continue;
    if (!PROGENITOR_ELEMENTS.includes(frame.Progenitor)) continue;
    out[frame.Name] = frame.Progenitor;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
