// DE's language strings are game-client markup, not display text: <SCREAMING_SNAKE>
// inline icon glyphs (ExportTextIcons names ~670 of them) and |PIPE| placeholders the
// client fills from live stats. Neither renders outside the game, so every game string
// crossing into the app goes through here.

/** Icon token -> the element key the rest of the app names elements by. */
export const DAMAGE_TYPE_ELEMENTS: Readonly<Record<string, string>> = {
  DT_IMPACT: "impact",
  DT_PUNCTURE: "puncture",
  DT_SLASH: "slash",
  DT_FREEZE: "cold",
  DT_FIRE: "heat",
  DT_POISON: "toxin",
  DT_ELECTRICITY: "electric",
  DT_GAS: "gas",
  DT_VIRAL: "viral",
  DT_MAGNETIC: "magnetic",
  DT_RADIATION: "radiation",
  DT_CORROSIVE: "corrosive",
  DT_EXPLOSION: "blast",
  DT_RADIANT: "void",
  DT_SENTIENT: "sentient",
  DT_TAU: "tau",
  DT_FINISHER: "true",
};

/** English element names; a localized surface passes its own via `elementName`. */
export const ELEMENT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  impact: "Impact",
  puncture: "Puncture",
  slash: "Slash",
  cold: "Cold",
  heat: "Heat",
  toxin: "Toxin",
  electric: "Electricity",
  gas: "Gas",
  viral: "Viral",
  magnetic: "Magnetic",
  radiation: "Radiation",
  corrosive: "Corrosive",
  blast: "Blast",
  void: "Void",
  sentient: "Sentient",
  tau: "Tau",
  true: "True",
};

// A damage-type icon comes in tinted, outlined and spaced variants. The _COLOR family
// only tints the word that follows it, so it carries no name of its own.
const TINT_SUFFIX = /_(?:TINT_)?COLOR(?:_NO_ADV)?$/;
const GLYPH_SUFFIX = /_(?:OUTLINE|SPACE)$/;

/** Markup that structures a string rather than standing in for a value. */
const STRUCTURE_PLACEHOLDERS = new Set(["BREAK", "COLOR", "NO_COLOR", "TITLE_START", "TITLE_END"]);

/** Markup borrowed from HTML; lowercase, so the snake-case guard misses it. */
const HTML_TAGS = new Set(["br", "b", "i", "p", "u"]);

const TOKEN_RE = /<\/?([A-Za-z][A-Za-z0-9_]*)\/?>/g;
const PLACEHOLDER_RE = /\|([A-Za-z][A-Za-z0-9_]*)\|/g;
// DE wraps a bounty's title line in a colour span; the app shows that line itself.
const COLOR_SPAN_RE = /\|OPEN_COLOR\|[^|]*\|CLOSE_COLOR\|\s*/g;

/** Prose can hold a stray `<x>`; a game token is snake-cased, shouted, or HTML. */
function isGameToken(name: string): boolean {
  if (HTML_TAGS.has(name.toLowerCase())) return true;
  return name.includes("_") || /^[A-Z][A-Z0-9]*$/.test(name);
}

/**
 * Element key a damage-type icon token names, or null when the token only tints
 * the word beside it. An unlisted `DT_` token falls back to its own tail, so a
 * damage type DE adds tomorrow reads as a name instead of leaking or vanishing.
 */
export function damageTypeElement(token: string): string | null {
  if (!token.startsWith("DT_")) return null;
  if (TINT_SUFFIX.test(token)) return null;
  const base = token.replace(GLYPH_SUFFIX, "");
  return DAMAGE_TYPE_ELEMENTS[base] || base.slice(3).toLowerCase() || null;
}

export interface GameMarkupOptions {
  /** Values for |PIPE| placeholders, matched on the placeholder name, any case. */
  values?: Readonly<Record<string, string | number | null | undefined>>;
  /** Stands in for a placeholder with no value; never the raw `|DURATION|`. */
  placeholder?: string;
  /** Element key -> name, for a surface that has translations. */
  elementName?: (element: string) => string;
}

/**
 * Icon tokens out, damage types named. Item names take this pass alone: they carry
 * icon markers but never placeholders, and they are join keys for market lookups.
 */
export function stripGameTokens(raw: string, options: GameMarkupOptions = {}): string {
  const elementName = options.elementName ?? defaultElementName;
  const replaced = raw.replace(TOKEN_RE, (match, name: string, offset: number, whole: string) => {
    if (!isGameToken(name)) return match;
    const element = damageTypeElement(name);
    if (!element) return " ";
    const label = elementName(element);
    // The icon nearly always sits against the word it decorates; only a bare one
    // has to supply the name itself.
    const rest = whole.slice(offset + match.length);
    const alreadyNamed = new RegExp(`^\\s*${escapeForRegex(label)}\\b`, "i").test(rest);
    return alreadyNamed ? " " : ` ${label} `;
  });
  return collapse(replaced);
}

/**
 * Icon tokens out of a join key. A key has usually been case-folded already, which
 * hides a shouted token from the prose guard; a key is never prose, so every
 * token in one is markup.
 */
export function stripGameTokensFromKey(raw: string): string {
  return stripGameTokens(
    raw.replace(TOKEN_RE, (_match, name: string) => `<${name.toUpperCase()}>`),
  );
}

/** A whole game string as display text: icons resolved, placeholders filled. */
export function gameTextToDisplay(raw: string, options: GameMarkupOptions = {}): string {
  const fallback = options.placeholder ?? "X";
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(options.values ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    values.set(key.toLowerCase(), String(value));
  }
  const filled = raw.replace(COLOR_SPAN_RE, "").replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (STRUCTURE_PLACEHOLDERS.has(name.toUpperCase())) return " ";
    return values.get(name.toLowerCase()) ?? fallback;
  });
  return stripGameTokens(filled, options);
}

function defaultElementName(element: string): string {
  return (
    ELEMENT_DISPLAY_NAMES[element] ??
    element.charAt(0).toUpperCase() + element.slice(1).toLowerCase()
  );
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapse(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:%)])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .trim();
}
