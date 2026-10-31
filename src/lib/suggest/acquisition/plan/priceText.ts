import { SYNDICATE_RANKS } from "../../../../data/syndicateRanks.js";
import { rankSyndicate } from "./ranks.js";
import { resourceEntry, type ResourceLookup } from "./resources.js";
import type { PlanCurrency, PlanRank } from "./schema.js";

/** What a bare figure or rank in the text is taken to mean. */
export interface PriceHints {
  /** The standing currency a bare "5,000 standing" is paid in. */
  standing: string | null;
  /** The syndicate a bare "Rank 2" or rank title belongs to. */
  syndicate: string | null;
}

/** A price or rank lifted out of authored text, and the text that is left. */
export interface PriceRead {
  text: string | null;
  price: PlanCurrency[];
  rank: PlanRank | null;
  reusable: boolean | null;
  /** True when a figure carried "each": a price per unit, not for the lot. */
  each: boolean;
  /** True when a figure carried "total": a sum of prices stated elsewhere. */
  total: boolean;
  /** The syndicate a rank or a standing figure named, even a Neutral one. */
  syndicate: string | null;
  /** Clauses still naming a price or a rank that no rule could place. */
  unplaced: string[];
}

interface ReadOptions {
  /** Credit figures stay in the text: a foundry line's build cost. */
  keepCredits?: boolean;
  lookup?: ResourceLookup;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function alternation(names: Iterable<string>): string {
  return [...new Set(names)]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
}

const SYNDICATE_NAMES = alternation(
  SYNDICATE_RANKS.flatMap((meta) => [meta.name, meta.name.replace(/^The\s+/i, "")]),
);
const TITLES = alternation(
  SYNDICATE_RANKS.flatMap((meta) => meta.titles.map((title) => title.name.toLowerCase())),
);
const NEUTRAL = "neutral";

const AMOUNT =
  /^(~)?(\d{1,3}(?:,\d{3})+|\d+)(k)?\s*(?:([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,3})\s+)?(standing|cr|credits|platinum|plat)(?:\s+(each|total))?$/i;
const SYNDICATE_PREFIX = new RegExp(`^(${SYNDICATE_NAMES})\\b\\s*`, "i");
const TITLE_PREFIX = new RegExp(`^(${TITLES}|${NEUTRAL})(?![\\w&-])`, "i");
const RANK_WORD = /^rank\b\s*/i;
const LEVEL = /^(-?\d)\b\s*[:,]?\s*/;
const TRAILING_RANK = /\s+rank$/i;
const LEADING_RANK = new RegExp(
  `^(rank\\s+-?\\d\\b(?:\\s*:?\\s*(?:${TITLES})(?![\\w&-]))?)\\s+(.+)$`,
  "i",
);
const AT_RANK = /^(.*\S)\s+at\s+(.+)$/i;
const PARENS = /^(.*?)\s*\(([^()]*)\)$/;

/** Everything that reads as a price or a syndicate rank in free text. */
const FIGURES = [
  /~?\d[\d,]*(?:\.\d+)?\s*k?\s*(?:[A-Z][\w'&-]*\s+){0,3}(?:standing|platinum|plat|credits|cr)\b/gi,
  /(?<!mastery\s|intrinsics?\s|MR\s)\brank\s+(?:-[12]|[0-5])(?![\d.%])/gi,
  new RegExp(
    `\\b(?:${SYNDICATE_NAMES})\\s+(?:rank\\s+)?(?:${TITLES})(?![\\w&-]|\\s+Tokens?\\b)`,
    "gi",
  ),
  new RegExp(`\\b(?:${TITLES})\\s+rank\\b`, "gi"),
  /\bNeutral\b/g,
];

/** The price and rank fragments in a text, as written. */
export function figuresIn(text: string): string[] {
  return FIGURES.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
}

/** True for a fragment that is only a credit figure, which a foundry line may carry. */
export function isCreditFigure(fragment: string): boolean {
  return /\d\s*(?:cr|credits)$/i.test(fragment.trim());
}

type Clause =
  | { kind: "price"; price: PlanCurrency; each: boolean; total: boolean }
  | { kind: "rank"; syndicate: string | null; level: number; title: string | null; text: string }
  | { kind: "reusable"; reusable: boolean }
  | { kind: "text"; text: string }
  | { kind: "unplaced"; text: string };

interface Reader {
  hints: PriceHints;
  lookup: ResourceLookup;
  keepCredits: boolean;
}

function standingCurrency(name: string, lookup: ResourceLookup): string | null {
  const bare = name.replace(/^The\s+/i, "");
  for (const candidate of [`${name} Standing`, `${bare} Standing`]) {
    const entry = lookup(candidate);
    if (entry?.kind === "standing") return entry.spelled;
  }
  return null;
}

function readAmount(clause: string, reader: Reader): Clause | null {
  const match = AMOUNT.exec(clause);
  if (!match) return null;
  const [, approx, amount, thousands, name, word, suffix] = match;
  if (approx || thousands) return { kind: "unplaced", text: clause };
  const unit = word.toLowerCase();
  let currency: string | null;
  if (unit === "cr" || unit === "credits") {
    if (reader.keepCredits && !name) return { kind: "text", text: clause };
    currency = name ? null : "Credits";
  } else if (unit === "platinum" || unit === "plat") currency = name ? null : "Platinum";
  else currency = name ? standingCurrency(name, reader.lookup) : reader.hints.standing;
  if (!currency) return { kind: "unplaced", text: clause };
  return {
    kind: "price",
    price: { currency, amount },
    each: suffix?.toLowerCase() === "each",
    total: suffix?.toLowerCase() === "total",
  };
}

function syndicateOwning(title: string, hint: string | null): string | null {
  const owners = SYNDICATE_RANKS.filter((meta) =>
    meta.titles.some((entry) => entry.name.toLowerCase() === title),
  );
  const hinted = hint ? rankSyndicate(hint) : null;
  if (hinted && owners.includes(hinted)) return hinted.name;
  return owners.length === 1 ? owners[0].name : null;
}

/** "Rank 2 Rapscallion", "Ostron rank Trusted", "Stranger rank", "Rank 0: Neutral".
 *  Null when the clause is not a rank at all. */
function readRank(clause: string, reader: Reader): Clause | null {
  let rest = clause.trim().replace(/^at\s+/i, "");
  const named = SYNDICATE_PREFIX.exec(rest);
  if (named) rest = rest.slice(named[0].length);
  const word = RANK_WORD.exec(rest);
  if (word) rest = rest.slice(word[0].length);
  const level = word ? LEVEL.exec(rest) : null;
  if (level) rest = rest.slice(level[0].length);
  const titled = TITLE_PREFIX.exec(rest);
  if (titled) rest = rest.slice(titled[0].length);
  rest = rest.replace(TRAILING_RANK, "").trim();
  if (rest !== "" || !(level || titled)) return null;

  const title = titled ? titled[1].toLowerCase() : null;
  const written = level ? Number(level[1]) : null;
  const owner = named ? (rankSyndicate(named[1])?.name ?? null) : null;
  if (named && !owner) return { kind: "unplaced", text: clause };
  if (title === NEUTRAL) {
    if (written !== null && written !== 0) return { kind: "unplaced", text: clause };
    return { kind: "rank", syndicate: owner, level: 0, title, text: clause };
  }
  if (!title) return { kind: "rank", syndicate: owner, level: written ?? 0, title, text: clause };
  const syndicate = owner ?? syndicateOwning(title, reader.hints.syndicate);
  const entry = syndicate
    ? rankSyndicate(syndicate)?.titles.find((candidate) => candidate.name.toLowerCase() === title)
    : null;
  if (!syndicate || !entry || (written !== null && written !== entry.level)) {
    return { kind: "unplaced", text: clause };
  }
  return { kind: "rank", syndicate, level: entry.level, title, text: clause };
}

function readClause(clause: string, reader: Reader): Clause[] {
  const trimmed = clause.trim();
  if (/^reusable$/i.test(trimmed)) return [{ kind: "reusable", reusable: true }];
  if (/^one use$/i.test(trimmed)) return [{ kind: "reusable", reusable: false }];
  const whole = readAmount(trimmed, reader) ?? readRank(trimmed, reader);
  if (whole) return [whole];

  const at = AT_RANK.exec(trimmed);
  const atRank = at ? readRank(at[2], reader) : null;
  if (at && atRank) return [...readClause(at[1], reader), atRank];

  const leading = LEADING_RANK.exec(trimmed);
  const leadingRank = leading ? readRank(leading[1], reader) : null;
  if (leading && leadingRank) return [leadingRank, ...readClause(leading[2], reader)];

  const parens = PARENS.exec(trimmed);
  if (parens && parens[1] !== "") {
    const inner = splitClauses(parens[2]).flatMap((part) => readClause(part, reader));
    if (inner.some((part) => part.kind !== "text")) {
      const kept = inner.filter((part) => part.kind === "text").map((part) => part.text);
      const base = readClause(parens[1], reader);
      return kept.length > 0
        ? [...base.slice(0, -1), withParens(base[base.length - 1], kept), ...rest(inner)]
        : [...base, ...rest(inner)];
    }
  }
  const figures = figuresIn(trimmed);
  const allowed = reader.keepCredits && figures.every(isCreditFigure);
  return [
    figures.length > 0 && !allowed
      ? { kind: "unplaced", text: trimmed }
      : { kind: "text", text: trimmed },
  ];
}

function rest(clauses: readonly Clause[]): Clause[] {
  return clauses.filter((part) => part.kind !== "text");
}

function withParens(clause: Clause, kept: readonly string[]): Clause {
  if (clause.kind !== "text") return clause;
  return { kind: "text", text: `${clause.text} (${kept.join(", ")})` };
}

/** Clauses split on "; ", ", " and " + ", outside parentheses. */
function splitClauses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    const plus = text.startsWith(" + ", index);
    if ((char === ";" || char === ",") && text[index + 1] === " ") {
      out.push(text.slice(start, index));
      start = index + 2;
    } else if (plus) {
      out.push(text.slice(start, index));
      start = index + 3;
    }
  }
  out.push(text.slice(start));
  return out.map((part) => part.trim()).filter((part) => part !== "");
}

/** A "Rank 2" and a "Curious" written side by side are one rank. */
function mergeRanks(
  ranks: readonly Extract<Clause, { kind: "rank" }>[],
  hint: string | null,
): PlanRank | null | undefined {
  if (ranks.length === 0) return null;
  const levels = new Set(ranks.map((rank) => rank.level));
  const named = new Set(ranks.flatMap((rank) => (rank.syndicate ? [rank.syndicate] : [])));
  const syndicate = named.size === 1 ? [...named][0] : named.size === 0 ? hint : null;
  const level = levels.size === 1 ? [...levels][0] : null;
  if (level === 0) return null;
  const meta = syndicate ? rankSyndicate(syndicate) : null;
  return meta && level !== null ? { syndicate: meta.name, level } : undefined;
}

/** Lifts every price and rank out of `text`. A clause it cannot place stays in the
 *  text and is listed in `unplaced`, so nothing is lost. */
export function readPrices(
  text: string | null,
  hints: PriceHints,
  options: ReadOptions = {},
): PriceRead {
  const first = readOnce(text, hints, options);
  // "4,000 standing, Solaris United Rapscallion": the rank says whose standing it is.
  const syndicate = hints.syndicate ?? first.syndicate;
  if ((hints.standing && hints.syndicate) || !syndicate) return first;
  const standing = hints.standing ?? standingCurrency(syndicate, options.lookup ?? resourceEntry);
  return readOnce(text, { standing, syndicate }, options);
}

function readOnce(text: string | null, hints: PriceHints, options: ReadOptions): PriceRead {
  const out: PriceRead = {
    text: null,
    price: [],
    rank: null,
    reusable: null,
    each: false,
    total: false,
    syndicate: null,
    unplaced: [],
  };
  if (text === null || text.trim() === "") return out;
  const lookup = options.lookup ?? resourceEntry;
  const reader: Reader = { hints, lookup, keepCredits: options.keepCredits === true };
  const ranks: Extract<Clause, { kind: "rank" }>[] = [];
  const segments = text.split(/\s*;\s*/).map((segment) => {
    const kept: string[] = [];
    for (const clause of splitClauses(segment).flatMap((part) => readClause(part, reader))) {
      if (clause.kind === "price") {
        if (out.price.some((price) => price.currency === clause.price.currency)) {
          out.unplaced.push(`${clause.price.amount} ${clause.price.currency}`);
          kept.push(`${clause.price.amount} ${clause.price.currency}`);
        } else out.price.push(clause.price);
        out.each ||= clause.each;
        out.total ||= clause.total;
      } else if (clause.kind === "rank") ranks.push(clause);
      else if (clause.kind === "reusable") out.reusable = clause.reusable;
      else {
        if (clause.kind === "unplaced") out.unplaced.push(clause.text);
        kept.push(clause.text);
      }
    }
    return kept.join(", ");
  });
  const rank = mergeRanks(ranks, hints.syndicate);
  if (rank === undefined) {
    const written = ranks.map((clause) => clause.text).join(", ");
    out.unplaced.push(written);
    segments.push(written);
  } else out.rank = rank;
  const named = ranks.find((clause) => clause.syndicate)?.syndicate;
  const paid = out.price.find((price) => lookup(price.currency)?.kind === "standing");
  out.syndicate =
    out.rank?.syndicate ??
    named ??
    (paid ? (rankSyndicate(paid.currency.replace(/\s+Standing$/i, ""))?.name ?? null) : null);
  const left = segments.filter((segment) => segment !== "").join("; ");
  out.text = left === "" ? null : left;
  return out;
}
