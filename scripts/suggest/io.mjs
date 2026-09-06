// Output handling shared by the suggest data builders.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DATA_DIR = path.join(REPO_ROOT, "src", "data", "suggest");
export const CACHE_DIR = path.join(REPO_ROOT, ".tmp");

// Prettier gates the tree, so the output is written the way it wants it and a
// rerun leaves the repo clean.
export async function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const options = (await resolveConfig(file)) ?? {};
  const text = await format(JSON.stringify(value), { ...options, filepath: file });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

/** DE ships ingredient and component names only as localization tags. */
export function loadLocalizationDict() {
  const file = path.join(REPO_ROOT, "node_modules", "warframe-public-export-plus", "dict.en.json");
  const dict = readJson(file, {});
  return (locTag) => dict[locTag] ?? null;
}
