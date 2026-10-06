import type * as SimulacrumFeed from "./simulacrumFeed.js";

/** The feed reads the ~510 KB scan-requirement table, so it loads on demand like
 *  the Codex tab's. */
export function loadSimulacrumFeed(): Promise<typeof SimulacrumFeed> {
  return import("./simulacrumFeed.js");
}
