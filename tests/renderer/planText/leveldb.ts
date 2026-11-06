import fs from "node:fs";
import path from "node:path";

/** A read-only LevelDB reader, just enough for Chromium's Local Storage: the
 *  write-ahead logs and the snappy-compressed tables. It never opens LOCK, so
 *  a running app keeps its database. */

interface Entry {
  seq: bigint;
  value: Buffer | null;
}

function varint(buf: Buffer, at: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = at;
  for (;;) {
    const byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7;
  }
}

function snappy(input: Buffer): Buffer {
  const [length, start] = varint(input, 0);
  let pos = start;
  const out = Buffer.alloc(length);
  let written = 0;
  while (pos < input.length) {
    const tag = input[pos++];
    const type = tag & 3;
    if (type === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const bytes = len - 59;
        len = input.readUIntLE(pos, bytes);
        pos += bytes;
      }
      len += 1;
      input.copy(out, written, pos, pos + len);
      pos += len;
      written += len;
      continue;
    }
    let len: number;
    let offset: number;
    if (type === 1) {
      len = ((tag >> 2) & 7) + 4;
      offset = ((tag >> 5) << 8) | input[pos++];
    } else if (type === 2) {
      len = (tag >> 2) + 1;
      offset = input.readUInt16LE(pos);
      pos += 2;
    } else {
      len = (tag >> 2) + 1;
      offset = input.readUInt32LE(pos);
      pos += 4;
    }
    // Copies may overlap their own output, so they go byte by byte.
    for (let index = 0; index < len; index++, written++) out[written] = out[written - offset];
  }
  return out;
}

function keep(entries: Map<string, Entry>, key: Buffer, seq: bigint, value: Buffer | null): void {
  const id = key.toString("latin1");
  const held = entries.get(id);
  if (!held || held.seq < seq) entries.set(id, { seq, value });
}

function readBatch(batch: Buffer, entries: Map<string, Entry>): void {
  let seq = batch.readBigUInt64LE(0);
  const count = batch.readUInt32LE(8);
  let pos = 12;
  for (let index = 0; index < count; index++, seq++) {
    const type = batch[pos++];
    const [keyLength, keyAt] = varint(batch, pos);
    const key = batch.subarray(keyAt, keyAt + keyLength);
    pos = keyAt + keyLength;
    if (type === 0) {
      keep(entries, key, seq, null);
      continue;
    }
    const [valueLength, valueAt] = varint(batch, pos);
    keep(entries, key, seq, batch.subarray(valueAt, valueAt + valueLength));
    pos = valueAt + valueLength;
  }
}

const LOG_BLOCK = 32768;

function readLog(file: Buffer, entries: Map<string, Entry>): void {
  let pending: Buffer[] = [];
  let pos = 0;
  while (pos + 7 <= file.length) {
    const left = LOG_BLOCK - (pos % LOG_BLOCK);
    if (left < 7) {
      pos += left;
      continue;
    }
    const length = file.readUInt16LE(pos + 4);
    const type = file[pos + 6];
    const data = file.subarray(pos + 7, pos + 7 + length);
    pos += 7 + length;
    if (type === 0) continue;
    if (type === 1) readBatch(data, entries);
    else if (type === 2) pending = [data];
    else if (type === 3) pending.push(data);
    else if (type === 4) {
      pending.push(data);
      readBatch(Buffer.concat(pending), entries);
      pending = [];
    }
  }
}

function readBlock(file: Buffer, offset: number, size: number): Buffer {
  const raw = file.subarray(offset, offset + size);
  return file[offset + size] === 1 ? snappy(raw) : raw;
}

function blockEntries(block: Buffer): [Buffer, Buffer][] {
  const restarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - restarts * 4;
  const out: [Buffer, Buffer][] = [];
  let last = Buffer.alloc(0);
  let pos = 0;
  while (pos < end) {
    const [shared, a] = varint(block, pos);
    const [unshared, b] = varint(block, a);
    const [valueLength, c] = varint(block, b);
    const key = Buffer.concat([last.subarray(0, shared), block.subarray(c, c + unshared)]);
    out.push([key, block.subarray(c + unshared, c + unshared + valueLength)]);
    last = key;
    pos = c + unshared + valueLength;
  }
  return out;
}

function readTable(file: Buffer, entries: Map<string, Entry>): void {
  const footer = file.subarray(file.length - 48);
  const [, afterMeta] = varint(footer, 0);
  const [, afterMetaSize] = varint(footer, afterMeta);
  const [indexOffset, afterIndex] = varint(footer, afterMetaSize);
  const [indexSize] = varint(footer, afterIndex);
  for (const [, handle] of blockEntries(readBlock(file, indexOffset, indexSize))) {
    const [offset, next] = varint(handle, 0);
    const [size] = varint(handle, next);
    for (const [internal, value] of blockEntries(readBlock(file, offset, size))) {
      const tag = internal.readBigUInt64LE(internal.length - 8);
      const key = internal.subarray(0, internal.length - 8);
      keep(entries, key, tag >> 8n, (tag & 0xffn) === 0n ? null : value);
    }
  }
}

/** Every live key in the database, newest write winning. */
function readLevelDb(dir: string): Map<string, Buffer> {
  const entries = new Map<string, Entry>();
  for (const name of fs.readdirSync(dir)) {
    const file = () => fs.readFileSync(path.join(dir, name));
    if (name.endsWith(".ldb") || name.endsWith(".sst")) readTable(file(), entries);
    else if (name.endsWith(".log") && name !== "LOG") readLog(file(), entries);
  }
  const live = new Map<string, Buffer>();
  for (const [key, entry] of entries) if (entry.value) live.set(key, entry.value);
  return live;
}

/** Chromium tags each stored string with its encoding: 0 UTF-16LE, 1 Latin-1. */
function decode(tagged: Buffer): string {
  return tagged.subarray(1).toString(tagged[0] === 0 ? "utf16le" : "latin1");
}

/** One origin's Local Storage as the page reads it; keys are `_<origin>\0` plus
 *  the tagged key. */
export function readLocalStorage(dir: string, origin: string): Map<string, string> {
  const prefix = Buffer.from(`_${origin}\u0000`, "latin1");
  const out = new Map<string, string>();
  for (const [key, value] of readLevelDb(dir)) {
    const raw = Buffer.from(key, "latin1");
    if (raw.subarray(0, prefix.length).equals(prefix)) {
      out.set(decode(raw.subarray(prefix.length)), decode(value));
    }
  }
  return out;
}
