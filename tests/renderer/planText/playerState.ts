import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { APP_PRODUCT_NAME } from "../../../config/shared/appMeta";
import { unwrapInventoryPayload } from "../../../config/shared/inventoryPayload.js";
import type { RawInventoryData } from "../../../src/types/inventory.js";
import { readLocalStorage } from "./leveldb.js";

/** Where the installed app keeps its userData; read here, never written. */
export const USER_DATA = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), ".config"),
  APP_PRODUCT_NAME,
);

/** The renderer's origin: the app loads its page from disk. */
const ORIGIN = "file://";

export interface SavedStorage {
  values: Map<string, string>;
  error: string | null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readSavedStorage(): SavedStorage {
  const dir = path.join(USER_DATA, "Local Storage", "leveldb");
  try {
    return { values: readLocalStorage(dir, ORIGIN), error: null };
  } catch (error) {
    return { values: new Map(), error: `local storage unreadable at ${dir}: ${message(error)}` };
  }
}

/** A Local Storage stand-in over the saved values: the stores read it the way
 *  they read the app's, and a write stays in memory. */
export function memoryStorage(values: Map<string, string>): Storage {
  const held = new Map(values);
  return {
    get length() {
      return held.size;
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, String(value)),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  };
}

export interface SavedInventory {
  data: RawInventoryData | null;
  path: string | null;
  modifiedAt: Date | null;
  error: string | null;
}

interface ReloadState {
  inventoryPath?: string;
  inventorySource?: string;
}

function readReloadState(): ReloadState {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(USER_DATA, "inventory-reload-state.json"), "utf8"),
    ) as ReloadState;
  } catch {
    return {};
  }
}

function jsonFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function newest(paths: readonly string[]): string | null {
  const existing = paths.filter((file) => fs.existsSync(file));
  existing.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return existing[0] ?? null;
}

/** The file the app's inventory source resolves to: a hand-picked import, or
 *  else the newest of the helper's output and the last remembered file. */
function inventoryFile(state: ReloadState): string | null {
  const remembered = state.inventoryPath ? [state.inventoryPath] : [];
  if (state.inventorySource === "manual") return newest(remembered);
  return newest([...jsonFiles(path.join(USER_DATA, "api-helper")), ...remembered]);
}

export function readSavedInventory(): SavedInventory {
  const state = readReloadState();
  const none = { data: null, path: null, modifiedAt: null };
  if (state.inventorySource === "aleca") {
    return { ...none, error: "inventory source is AlecaFrame, which this reader does not decode" };
  }
  const file = inventoryFile(state);
  if (!file) return { ...none, error: `no inventory file found under ${USER_DATA}` };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    const data = unwrapInventoryPayload(raw, { returnInputOnFailure: true }) as RawInventoryData;
    return { data, path: file, modifiedAt: fs.statSync(file).mtime, error: null };
  } catch (error) {
    return { ...none, path: file, error: `inventory unreadable at ${file}: ${message(error)}` };
  }
}
