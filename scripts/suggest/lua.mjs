// A reader for the `return { ... }` data modules the Warframe wiki stores its
// tables in. Pure - no network, no fs - so the parsers stay unit testable.

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;

// Lua counts the `=` signs, so [==[ ... ]==] only closes on a matching run.
const LONG_OPEN = /\[(=*)\[/y;

class Reader {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  error(message) {
    const line = this.text.slice(0, this.pos).split("\n").length;
    return new Error(`lua parse: ${message} at line ${line}`);
  }

  at(token) {
    return this.text.startsWith(token, this.pos);
  }

  match(re) {
    re.lastIndex = this.pos;
    const found = re.exec(this.text);
    if (!found) return null;
    this.pos = re.lastIndex;
    return found;
  }

  expect(token) {
    if (!this.at(token)) throw this.error(`expected "${token}"`);
    this.pos += token.length;
  }

  longBracket() {
    const open = this.match(LONG_OPEN);
    if (!open) return null;
    const close = `]${open[1]}]`;
    const end = this.text.indexOf(close, this.pos);
    if (end === -1) throw this.error("unterminated long bracket");
    const body = this.text.slice(this.pos, end);
    this.pos = end + close.length;
    return body.startsWith("\n") ? body.slice(1) : body;
  }

  skipTrivia() {
    for (;;) {
      const before = this.pos;
      while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
      if (this.at("--")) {
        this.pos += 2;
        if (this.longBracket() === null) {
          const end = this.text.indexOf("\n", this.pos);
          this.pos = end === -1 ? this.text.length : end;
        }
      }
      if (this.pos === before) return;
    }
  }
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v" };

function readQuoted(reader, quote) {
  reader.pos++;
  let out = "";
  while (reader.pos < reader.text.length) {
    const ch = reader.text[reader.pos];
    if (ch === quote) {
      reader.pos++;
      return out;
    }
    if (ch !== "\\") {
      out += ch;
      reader.pos++;
      continue;
    }
    const escape = reader.text[reader.pos + 1];
    reader.pos += 2;
    if (escape === "x") {
      out += String.fromCharCode(parseInt(reader.text.substr(reader.pos, 2), 16));
      reader.pos += 2;
    } else if (/\d/.test(escape)) {
      const digits = /\d{0,2}/y;
      digits.lastIndex = reader.pos;
      const rest = digits.exec(reader.text)[0];
      reader.pos += rest.length;
      out += String.fromCharCode(Number(escape + rest));
    } else if (escape === "\n") {
      out += "\n";
    } else {
      out += ESCAPES[escape] ?? escape;
    }
  }
  throw reader.error("unterminated string");
}

function readValue(reader) {
  reader.skipTrivia();
  const ch = reader.text[reader.pos];
  if (ch === undefined) throw reader.error("unexpected end of input");
  if (ch === '"' || ch === "'") return readQuoted(reader, ch);
  if (ch === "{") return readTable(reader);
  if (ch === "[") {
    const long = reader.longBracket();
    if (long !== null) return long;
  }
  if (reader.at("true")) {
    reader.pos += 4;
    return true;
  }
  if (reader.at("false")) {
    reader.pos += 5;
    return false;
  }
  if (reader.at("nil")) {
    reader.pos += 3;
    return null;
  }
  if (reader.at("math.huge")) {
    reader.pos += "math.huge".length;
    return Infinity;
  }
  if (reader.at("-math.huge")) {
    reader.pos += "-math.huge".length;
    return -Infinity;
  }
  const number = reader.match(NUMBER);
  if (number) return Number(number[0]);
  throw reader.error("unexpected value");
}

function readKey(reader) {
  if (reader.at("[")) {
    const save = reader.pos;
    if (reader.longBracket() !== null) {
      reader.pos = save;
      return null;
    }
    reader.pos = save + 1;
    const key = readValue(reader);
    reader.skipTrivia();
    reader.expect("]");
    reader.skipTrivia();
    reader.expect("=");
    return String(key);
  }
  const save = reader.pos;
  const name = reader.match(IDENTIFIER);
  if (!name) return null;
  reader.skipTrivia();
  // `Traits = { "Prime" }` is a key; a bare `true` in an array is not.
  if (!reader.at("=") || reader.at("==")) {
    reader.pos = save;
    return null;
  }
  reader.pos++;
  return name[0];
}

/** An array-only table stays an array; anything with a named key becomes an
 *  object, and the wiki never mixes the two in a way that loses data. */
function readTable(reader) {
  reader.expect("{");
  const array = [];
  const named = {};
  let hasNamed = false;
  for (;;) {
    reader.skipTrivia();
    if (reader.at("}")) {
      reader.pos++;
      return hasNamed ? Object.assign(named, arrayAsKeys(array)) : array;
    }
    const key = readKey(reader);
    const value = readValue(reader);
    if (key === null) array.push(value);
    else {
      named[key] = value;
      hasNamed = true;
    }
    reader.skipTrivia();
    if (reader.at(",") || reader.at(";")) reader.pos++;
    else if (!reader.at("}")) throw reader.error("expected , or }");
  }
}

function arrayAsKeys(array) {
  const out = {};
  array.forEach((value, index) => {
    out[index + 1] = value;
  });
  return out;
}

export function parseLuaTable(text) {
  const reader = new Reader(text);
  reader.skipTrivia();
  const start = text.indexOf("return", reader.pos);
  if (start === -1) throw new Error("lua parse: no return statement");
  reader.pos = start + "return".length;
  return readValue(reader);
}

/** `Module:Acquisition/data` builds its table out of locals, so the value the
 *  module returns has to be found by name rather than at the return keyword. */
export function parseLuaLocal(text, name) {
  const marker = new RegExp(`local\\s+${name}\\s*=\\s*`, "g");
  const found = marker.exec(text);
  if (!found) throw new Error(`lua parse: no local named ${name}`);
  const reader = new Reader(text);
  reader.pos = found.index + found[0].length;
  return readValue(reader);
}
