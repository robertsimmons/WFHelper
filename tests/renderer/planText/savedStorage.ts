import { memoryStorage, readSavedStorage } from "./playerState.js";

/** Loaded as a setup file, ahead of every store that reads Local Storage when
 *  its module first runs. */
export const SAVED_STORAGE = readSavedStorage();

Object.defineProperty(globalThis, "localStorage", {
  value: memoryStorage(SAVED_STORAGE.values),
  configurable: true,
});
